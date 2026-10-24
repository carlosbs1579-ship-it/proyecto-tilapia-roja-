import {
  collection,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  runTransaction
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/firebaseConfig';
import { Lote, EventoLote, TipoEvento, ConfiguracionGeneral } from '../types';
import { PRODUCTO_FIJO, MODALIDAD_FIJA, ORIGEN_FIJO, compactarFecha, getFechaHoyBogota } from '../utils/constants';
import { calcularHashEvento, HASH_GENESIS } from './hashService';
import { recalcularResumenLote } from './calculosService';
import { generarYSubirPdfLote } from './pdfService';
import { construirUrlPublicaPdf, construirUrlPublicaTrazabilidad } from './qrService';

const LOTES_STORAGE_KEY = 'cultivos_lore_lotes_db';
const CONTADORES_STORAGE_KEY = 'cultivos_lore_contadores_db';

// Listeners activos en memoria para reactividad instantánea
type LotesListener = (lotes: Lote[]) => void;
const listenersLotes: Set<LotesListener> = new Set();

type LoteIndividualListener = (lote: Lote | null) => void;
const listenersIndividuales: Map<string, Set<LoteIndividualListener>> = new Map();

/**
 * Obtiene los lotes del almacenamiento persistente local
 */
export function getLotesLocales(): Lote[] {
  try {
    const raw = localStorage.getItem(LOTES_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Lote[];
  } catch {
    return [];
  }
}

/**
 * Guarda lotes en almacenamiento persistente local y notifica a los componentes
 */
export function guardarLotesLocales(lotes: Lote[]): void {
  try {
    localStorage.setItem(LOTES_STORAGE_KEY, JSON.stringify(lotes));
  } catch (err) {
    console.warn('Error guardando en localStorage:', err);
  }

  // Notificar a todos los listeners suscritos
  listenersLotes.forEach((fn) => fn(lotes));

  // Notificar a listeners individuales
  for (const lote of lotes) {
    const setInd = listenersIndividuales.get(lote.codigo);
    if (setInd) {
      setInd.forEach((fn) => fn(lote));
    }
  }
}

/**
 * Obtiene y actualiza un contador atómico local
 */
function incrementarContadorLocal(key: string): number {
  try {
    const raw = localStorage.getItem(CONTADORES_STORAGE_KEY);
    const contadores: Record<string, number> = raw ? JSON.parse(raw) : {};
    const actual = contadores[key] || 0;
    const nuevo = actual + 1;
    contadores[key] = nuevo;
    localStorage.setItem(CONTADORES_STORAGE_KEY, JSON.stringify(contadores));
    return nuevo;
  } catch {
    return Math.floor(Date.now() % 1000) + 1;
  }
}

/**
 * Convierte un número incremental (1, 2, 26, 27...) a letra(s) (A, B, Z, AA, AB...)
 */
export function obtenerLetraConsecutiva(consecutivo: number): string {
  let num = Math.max(1, Math.floor(consecutivo));
  let letras = '';
  while (num > 0) {
    const rem = (num - 1) % 26;
    letras = String.fromCharCode(65 + rem) + letras;
    num = Math.floor((num - 1) / 26);
  }
  return letras || 'A';
}

export interface ParamsNuevoLote {
  estanque: string;
  fechaSiembra: string; // YYYY-MM-DD
  cantidadSembrada: number;
  pesoInicialPromedioG: number;
  proveedorAlevinos?: string;
  observaciones?: string;
  userEmail: string;
  config: ConfiguracionGeneral;
}

/**
 * Crea un nuevo lote con garantía de inalterabilidad, cálculo atómico de consecutivo
 * y almacenamiento resiliente (Firestore con sincronización local inmediata)
 */
export async function crearNuevoLote(params: ParamsNuevoLote): Promise<Lote> {
  const {
    estanque,
    fechaSiembra,
    cantidadSembrada,
    pesoInicialPromedioG,
    proveedorAlevinos,
    observaciones,
    userEmail,
    config
  } = params;

  const fechaCompacta = compactarFecha(fechaSiembra);
  const globalCounterRef = doc(db, 'contadores', 'lotes_global');
  const diarioCounterRef = doc(db, 'contadores', `diario_${fechaCompacta}_${estanque}`);

  // 1. Preparar consecutivo y código único
  let nuevoConsecutivoGlobal = 1;
  let nuevoConsecutivoDiario = 1;

  // Primero intentar obtener y escribir a través de la transacción de Firestore
  let exitoFirestore = false;
  let loteDataFinal: Lote | null = null;

  try {
    const nuevoLoteFs = await runTransaction(db, async (transaction) => {
      const globalSnap = await transaction.get(globalCounterRef);
      const diarioSnap = await transaction.get(diarioCounterRef);

      nuevoConsecutivoGlobal = (globalSnap.exists() ? Number(globalSnap.data()?.valor || 0) : 0) + 1;
      nuevoConsecutivoDiario = (diarioSnap.exists() ? Number(diarioSnap.data()?.valor || 0) : 0) + 1;

      const letra = obtenerLetraConsecutiva(nuevoConsecutivoDiario);
      const codigoGenerado = `${fechaCompacta}-${letra}-${estanque}`;

      const loteDocRef = doc(db, 'lotes', codigoGenerado);
      const loteSnap = await transaction.get(loteDocRef);
      if (loteSnap.exists()) {
        throw new Error(`El código de lote ${codigoGenerado} ya existe en el sistema.`);
      }

      const fechaIsoAhora = new Date().toISOString();
      const idEvento = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `ev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const datosSiembra = {
        cantidad: cantidadSembrada,
        pesoPromedioInicialG: pesoInicialPromedioG,
        proveedor: proveedorAlevinos?.trim() || ''
      };

      const hashSiembra = await calcularHashEvento({
        codigoLote: codigoGenerado,
        indice: 0,
        tipo: 'Siembra',
        fechaEvento: fechaSiembra,
        descripcion: observaciones?.trim() || 'Siembra inicial del lote en estanque ' + estanque,
        datos: datosSiembra,
        registradoPor: userEmail,
        registradoEn: fechaIsoAhora,
        hashAnterior: HASH_GENESIS
      });

      const primerEvento: EventoLote = {
        id: idEvento,
        indice: 0,
        tipo: 'Siembra',
        fechaEvento: fechaSiembra,
        descripcion: observaciones?.trim() || 'Siembra inicial del lote en estanque ' + estanque,
        datos: datosSiembra,
        registradoPor: userEmail,
        registradoEn: fechaIsoAhora,
        hashAnterior: HASH_GENESIS,
        hash: hashSiembra
      };

      const estanqueInfo = config.estanques.find((e) => e.codigo === estanque);
      const resumenInicial = recalcularResumenLote({
        fechaSiembra,
        cantidadSembrada,
        pesoInicialPromedioG,
        eventos: [primerEvento],
        estado: 'activo',
        fechaCierre: null,
        volumenEstanqueM3: estanqueInfo?.volumenM3,
        rangos: config.rangosReferencia
      });

      const loteData: Lote = {
        codigo: codigoGenerado,
        consecutivo: nuevoConsecutivoGlobal,
        estanque,
        producto: PRODUCTO_FIJO,
        modalidad: MODALIDAD_FIJA,
        origen: ORIGEN_FIJO,
        fechaSiembra,
        cantidadSembrada,
        pesoInicialPromedioG,
        proveedorAlevinos: proveedorAlevinos?.trim() || '',
        estado: 'activo',
        fechaCierre: null,
        eventos: [primerEvento],
        resumen: resumenInicial,
        pdfPath: `lotes/${codigoGenerado}.pdf`,
        pdfUrl: construirUrlPublicaPdf(codigoGenerado),
        versionPdf: 1,
        pdfActualizadoEn: fechaIsoAhora,
        creadoPor: userEmail,
        creadoEn: fechaIsoAhora,
        actualizadoEn: fechaIsoAhora,
        observacionesIniciales: observaciones?.trim() || ''
      };

      transaction.set(
        globalCounterRef,
        { valor: nuevoConsecutivoGlobal, actualizadoEn: fechaIsoAhora },
        { merge: true }
      );
      transaction.set(
        diarioCounterRef,
        { valor: nuevoConsecutivoDiario, actualizadoEn: fechaIsoAhora },
        { merge: true }
      );
      transaction.set(loteDocRef, loteData);

      return loteData;
    });

    loteDataFinal = nuevoLoteFs;
    exitoFirestore = true;
  } catch (fsErr: any) {
    console.warn('Transacción Firestore no completada (utilizando persistencia local de contingencia):', fsErr?.message || fsErr);
  }

  // 2. Si Firestore falló o tuvo restricciones de permisos, garantizar creación local perfecta
  if (!loteDataFinal) {
    const lotesActuales = getLotesLocales();
    // Calcular consecutivo global y diario local
    nuevoConsecutivoGlobal = incrementarContadorLocal('lotes_global');
    nuevoConsecutivoDiario = incrementarContadorLocal(`diario_${fechaCompacta}_${estanque}`);

    const letra = obtenerLetraConsecutiva(nuevoConsecutivoDiario);
    const codigoGenerado = `${fechaCompacta}-${letra}-${estanque}`;

    const fechaIsoAhora = new Date().toISOString();
    const idEvento = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `ev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const datosSiembra = {
      cantidad: cantidadSembrada,
      pesoPromedioInicialG: pesoInicialPromedioG,
      proveedor: proveedorAlevinos?.trim() || ''
    };

    const hashSiembra = await calcularHashEvento({
      codigoLote: codigoGenerado,
      indice: 0,
      tipo: 'Siembra',
      fechaEvento: fechaSiembra,
      descripcion: observaciones?.trim() || 'Siembra inicial del lote en estanque ' + estanque,
      datos: datosSiembra,
      registradoPor: userEmail,
      registradoEn: fechaIsoAhora,
      hashAnterior: HASH_GENESIS
    });

    const primerEvento: EventoLote = {
      id: idEvento,
      indice: 0,
      tipo: 'Siembra',
      fechaEvento: fechaSiembra,
      descripcion: observaciones?.trim() || 'Siembra inicial del lote en estanque ' + estanque,
      datos: datosSiembra,
      registradoPor: userEmail,
      registradoEn: fechaIsoAhora,
      hashAnterior: HASH_GENESIS,
      hash: hashSiembra
    };

    const estanqueInfo = config.estanques.find((e) => e.codigo === estanque);
    const resumenInicial = recalcularResumenLote({
      fechaSiembra,
      cantidadSembrada,
      pesoInicialPromedioG,
      eventos: [primerEvento],
      estado: 'activo',
      fechaCierre: null,
      volumenEstanqueM3: estanqueInfo?.volumenM3,
      rangos: config.rangosReferencia
    });

    loteDataFinal = {
      codigo: codigoGenerado,
      consecutivo: nuevoConsecutivoGlobal,
      estanque,
      producto: PRODUCTO_FIJO,
      modalidad: MODALIDAD_FIJA,
      origen: ORIGEN_FIJO,
      fechaSiembra,
      cantidadSembrada,
      pesoInicialPromedioG,
      proveedorAlevinos: proveedorAlevinos?.trim() || '',
      estado: 'activo',
      fechaCierre: null,
      eventos: [primerEvento],
      resumen: resumenInicial,
      pdfPath: `lotes/${codigoGenerado}.pdf`,
      pdfUrl: construirUrlPublicaPdf(codigoGenerado),
      versionPdf: 1,
      pdfActualizadoEn: fechaIsoAhora,
      creadoPor: userEmail,
      creadoEn: fechaIsoAhora,
      actualizadoEn: fechaIsoAhora,
      observacionesIniciales: observaciones?.trim() || ''
    };
  }

  // Guardar en la base de datos local y emitir reactividad a toda la app
  const todosLosLotes = getLotesLocales();
  const actualizados = [loteDataFinal, ...todosLosLotes.filter((l) => l.codigo !== loteDataFinal!.codigo)];
  guardarLotesLocales(actualizados);

  // Asegurar escritura persistente e inalterable en Firestore para trazabilidad pública desde cualquier teléfono
  try {
    const loteRef = doc(db, 'lotes', loteDataFinal.codigo);
    await setDoc(loteRef, loteDataFinal, { merge: true });
    // Mantener contadores en Firestore si es posible
    setDoc(globalCounterRef, { valor: nuevoConsecutivoGlobal, actualizadoEn: new Date().toISOString() }, { merge: true }).catch(() => {});
    setDoc(diarioCounterRef, { valor: nuevoConsecutivoDiario, actualizadoEn: new Date().toISOString() }, { merge: true }).catch(() => {});
  } catch (fsErr) {
    console.warn('Escritura a Firestore diferida (disponible localmente):', fsErr);
  }

  return loteDataFinal;
}

export interface ParamsAgregarEvento {
  codigoLote: string;
  tipo: TipoEvento;
  fechaEvento: string;
  descripcion: string;
  datos: Record<string, any>;
  userEmail: string;
  config: ConfiguracionGeneral;
}

/**
 * Agrega un nuevo evento a la cadena inalterable, calculando el hash SHA-256
 * y garantizando la persistencia tanto en Firestore como en memoria local
 */
export async function registrarEventoEnLote(params: ParamsAgregarEvento): Promise<Lote> {
  const { codigoLote, tipo, fechaEvento, descripcion, datos, userEmail, config } = params;
  const loteRef = doc(db, 'lotes', codigoLote);

  // Obtener el lote de la fuente disponible
  const lotesLocales = getLotesLocales();
  const loteBase = lotesLocales.find((l) => l.codigo === codigoLote);

  let loteActualizado: Lote | null = null;

  // 1. Intentar transacción de Firestore
  try {
    loteActualizado = await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(loteRef);
      const lote = snap.exists() ? (snap.data() as Lote) : loteBase;
      if (!lote) {
        throw new Error(`El lote ${codigoLote} no existe.`);
      }

      const eventosActuales = lote.eventos || [];
      const nuevoIndice = eventosActuales.length;
      const hashAnterior = nuevoIndice === 0 ? HASH_GENESIS : eventosActuales[nuevoIndice - 1].hash;

      const fechaIsoAhora = new Date().toISOString();
      const idEvento = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `ev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const hash = await calcularHashEvento({
        codigoLote,
        indice: nuevoIndice,
        tipo,
        fechaEvento,
        descripcion: descripcion || '',
        datos: datos || {},
        registradoPor: userEmail,
        registradoEn: fechaIsoAhora,
        hashAnterior
      });

      const nuevoEvento: EventoLote = {
        id: idEvento,
        indice: nuevoIndice,
        tipo,
        fechaEvento,
        descripcion: descripcion || '',
        datos: datos || {},
        registradoPor: userEmail,
        registradoEn: fechaIsoAhora,
        hashAnterior,
        hash
      };

      const listaEventosActualizada = [...eventosActuales, nuevoEvento];
      const estanqueInfo = config.estanques.find((e) => e.codigo === lote.estanque);
      const nuevoResumen = recalcularResumenLote({
        fechaSiembra: lote.fechaSiembra,
        cantidadSembrada: lote.cantidadSembrada,
        pesoInicialPromedioG: lote.pesoInicialPromedioG,
        eventos: listaEventosActualizada,
        estado: lote.estado,
        fechaCierre: lote.fechaCierre,
        volumenEstanqueM3: estanqueInfo?.volumenM3,
        rangos: config.rangosReferencia
      });

      const patch: Partial<Lote> = {
        eventos: listaEventosActualizada,
        resumen: nuevoResumen,
        actualizadoEn: fechaIsoAhora
      };

      transaction.update(loteRef, patch);

      return {
        ...lote,
        ...patch
      } as Lote;
    });
  } catch (fsErr: any) {
    console.warn('Transacción Firestore para evento no completada (usando almacenamiento local):', fsErr?.message || fsErr);
  }

  // 2. Si Firestore falló, aplicar la actualización criptográfica localmente
  if (!loteActualizado && loteBase) {
    const eventosActuales = loteBase.eventos || [];
    const nuevoIndice = eventosActuales.length;
    const hashAnterior = nuevoIndice === 0 ? HASH_GENESIS : eventosActuales[nuevoIndice - 1].hash;

    const fechaIsoAhora = new Date().toISOString();
    const idEvento = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `ev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const hash = await calcularHashEvento({
      codigoLote,
      indice: nuevoIndice,
      tipo,
      fechaEvento,
      descripcion: descripcion || '',
      datos: datos || {},
      registradoPor: userEmail,
      registradoEn: fechaIsoAhora,
      hashAnterior
    });

    const nuevoEvento: EventoLote = {
      id: idEvento,
      indice: nuevoIndice,
      tipo,
      fechaEvento,
      descripcion: descripcion || '',
      datos: datos || {},
      registradoPor: userEmail,
      registradoEn: fechaIsoAhora,
      hashAnterior,
      hash
    };

    const listaEventosActualizada = [...eventosActuales, nuevoEvento];
    const estanqueInfo = config.estanques.find((e) => e.codigo === loteBase.estanque);
    const nuevoResumen = recalcularResumenLote({
      fechaSiembra: loteBase.fechaSiembra,
      cantidadSembrada: loteBase.cantidadSembrada,
      pesoInicialPromedioG: loteBase.pesoInicialPromedioG,
      eventos: listaEventosActualizada,
      estado: loteBase.estado,
      fechaCierre: loteBase.fechaCierre,
      volumenEstanqueM3: estanqueInfo?.volumenM3,
      rangos: config.rangosReferencia
    });

    loteActualizado = {
      ...loteBase,
      eventos: listaEventosActualizada,
      resumen: nuevoResumen,
      actualizadoEn: fechaIsoAhora
    };
  }

  if (!loteActualizado) {
    throw new Error(`El lote ${codigoLote} no pudo ser encontrado para registrar el evento.`);
  }

  // Si el lote ya estaba cerrado, regenerar PDF
  if (loteActualizado.estado === 'cerrado') {
    generarYSubirPdfLote(loteActualizado, config)
      .then(({ versionPdf }) => {
        loteActualizado!.versionPdf = versionPdf;
        loteActualizado!.pdfActualizadoEn = new Date().toISOString();
        const lista = getLotesLocales().map((l) => (l.codigo === codigoLote ? loteActualizado! : l));
        guardarLotesLocales(lista);
      })
      .catch((err) => console.warn('Regeneración PDF:', err));
  }

  // Guardar en almacenamiento local y notificar reactivamente
  const lista = getLotesLocales().map((l) => (l.codigo === codigoLote ? loteActualizado! : l));
  guardarLotesLocales(lista);

  // Sincronizar siempre el lote íntegro en Firestore
  setDoc(loteRef, loteActualizado, { merge: true }).catch((err) => {
    console.warn('Firestore registrarEvento sincronizado localmente:', err?.message || err);
  });

  return loteActualizado;
}

/**
 * Sincroniza todos los lotes locales existentes con Cloud Firestore.
 * Esto asegura que cualquier lote creado previamente esté disponible de inmediato
 * en internet para escaneos de códigos QR desde teléfonos móviles.
 */
export async function sincronizarLotesConFirestore(): Promise<void> {
  const locales = getLotesLocales();
  if (locales.length === 0) return;
  for (const lote of locales) {
    try {
      const loteRef = doc(db, 'lotes', lote.codigo);
      await setDoc(loteRef, lote, { merge: true });
    } catch (err) {
      console.warn('Error sincronizando lote a Firestore:', lote.codigo, err);
    }
  }
}

/**
 * Cierra un lote productivo, genera el certificado PDF y actualiza estado de manera inmediata y sin bloqueos
 */
export async function cerrarLote(
  codigoLote: string,
  userEmail: string,
  config: ConfiguracionGeneral
): Promise<Lote> {
  const codigoLimpio = codigoLote.trim();
  const loteRef = doc(db, 'lotes', codigoLimpio);
  const fechaCierre = getFechaHoyBogota();
  const fechaIsoAhora = new Date().toISOString();

  const lotesLocales = getLotesLocales();
  let loteBase = lotesLocales.find((l) => l.codigo.trim().toUpperCase() === codigoLimpio.toUpperCase());

  // Si no está en local, intentar recuperar de Firestore
  if (!loteBase) {
    try {
      const snap = await getDoc(loteRef);
      if (snap.exists()) {
        loteBase = snap.data() as Lote;
      }
    } catch (err) {
      console.warn('Error buscando lote en Firestore para cierre:', err);
    }
  }

  if (!loteBase) {
    throw new Error(`El lote ${codigoLimpio} no fue encontrado para proceder con el cierre.`);
  }

  const estanqueInfo = config.estanques.find((e) => e.codigo === loteBase.estanque);
  const nuevoResumen = recalcularResumenLote({
    fechaSiembra: loteBase.fechaSiembra,
    cantidadSembrada: loteBase.cantidadSembrada,
    pesoInicialPromedioG: loteBase.pesoInicialPromedioG,
    eventos: loteBase.eventos || [],
    estado: 'cerrado',
    fechaCierre,
    volumenEstanqueM3: estanqueInfo?.volumenM3,
    rangos: config.rangosReferencia
  });

  const urlPublicaTrazabilidad = construirUrlPublicaTrazabilidad(codigoLimpio);
  const nuevaVersionPdf = (loteBase.versionPdf || 0) + 1;

  const loteCerrado: Lote = {
    ...loteBase,
    estado: 'cerrado',
    fechaCierre,
    resumen: nuevoResumen,
    pdfPath: `lotes/${codigoLimpio}.pdf`,
    pdfUrl: urlPublicaTrazabilidad,
    versionPdf: nuevaVersionPdf,
    pdfActualizadoEn: fechaIsoAhora,
    actualizadoEn: fechaIsoAhora
  };

  // 1. Guardar de inmediato localmente y notificar a los oyentes de la app
  const lista = lotesLocales.map((l) => (l.codigo.trim().toUpperCase() === codigoLimpio.toUpperCase() ? loteCerrado : l));
  if (!lista.some((l) => l.codigo === loteCerrado.codigo)) {
    lista.unshift(loteCerrado);
  }
  guardarLotesLocales(lista);

  // 2. Generar el PDF y subirlo a Storage de fondo (con timeout de protección para nunca colgar la UI)
  generarYSubirPdfLote(loteCerrado, config)
    .then(({ urlPublica, versionPdf }) => {
      loteCerrado.versionPdf = versionPdf;
      loteCerrado.pdfUrl = urlPublica;
      const actualizados = getLotesLocales().map((l) => (l.codigo === codigoLimpio ? loteCerrado : l));
      guardarLotesLocales(actualizados);
    })
    .catch((pdfErr) => {
      console.warn('Generación de PDF en segundo plano:', pdfErr);
    });

  // 3. Sincronizar el lote COMPLETO en Firestore para trazabilidad pública inalterable
  try {
    await setDoc(loteRef, loteCerrado, { merge: true });
  } catch (err: any) {
    console.warn('Firestore cerrarLote sincronizado localmente:', err?.message || err);
  }

  return loteCerrado;
}

/**
 * Escucha la lista completa de lotes combinando Firestore y la persistencia local
 */
export function escucharLotes(
  onUpdate: (lotes: Lote[]) => void,
  onError?: (error: any) => void
): () => void {
  // Emitir inmediatamente los datos locales existentes
  const iniciales = getLotesLocales();
  onUpdate(iniciales);

  // Sincronizar en segundo plano todos los lotes locales con Firestore
  sincronizarLotesConFirestore().catch(() => {});

  // Registrar callback en la lista de observadores
  listenersLotes.add(onUpdate);

  // Escuchar Firestore
  const lotesColRef = collection(db, 'lotes');
  const unsubFs = onSnapshot(
    lotesColRef,
    (snapshot) => {
      const listaFs: Lote[] = [];
      snapshot.forEach((docSnap) => {
        listaFs.push(docSnap.data() as Lote);
      });

      if (listaFs.length > 0) {
        // Mezclar con los locales manteniendo los más recientes
        const locales = getLotesLocales();
        const mapa = new Map<string, Lote>();
        locales.forEach((l) => mapa.set(l.codigo, l));
        listaFs.forEach((l) => mapa.set(l.codigo, l));

        const combinados = Array.from(mapa.values());
        combinados.sort((a, b) => (b.consecutivo || 0) - (a.consecutivo || 0));
        guardarLotesLocales(combinados);
      }
    },
    (error) => {
      console.warn('Firestore onSnapshot lotes en modo contingencia:', error?.message || error);
      // No arrojar error crítico: la UI sigue funcionando con datos locales
      onUpdate(getLotesLocales());
    }
  );

  return () => {
    listenersLotes.delete(onUpdate);
    unsubFs();
  };
}

/**
 * Escucha un lote individual en tiempo real
 */
export function escucharLoteIndividual(
  codigoLote: string,
  onUpdate: (lote: Lote | null) => void,
  onError?: (error: any) => void
): () => void {
  // Emitir inmediatamente versión local
  const locales = getLotesLocales();
  const loteLocal = locales.find((l) => l.codigo === codigoLote) || null;
  onUpdate(loteLocal);

  // Registrar en mapa de observadores
  if (!listenersIndividuales.has(codigoLote)) {
    listenersIndividuales.set(codigoLote, new Set());
  }
  listenersIndividuales.get(codigoLote)!.add(onUpdate);

  // Escuchar Firestore
  const loteRef = doc(db, 'lotes', codigoLote);
  const unsubFs = onSnapshot(
    loteRef,
    (snap) => {
      if (snap.exists()) {
        const l = snap.data() as Lote;
        onUpdate(l);
      }
    },
    (error) => {
      console.warn(`Firestore onSnapshot lote ${codigoLote} (modo contingencia):`, error?.message || error);
      onUpdate(getLotesLocales().find((l) => l.codigo === codigoLote) || null);
    }
  );

  return () => {
    const s = listenersIndividuales.get(codigoLote);
    if (s) {
      s.delete(onUpdate);
      if (s.size === 0) listenersIndividuales.delete(codigoLote);
    }
    unsubFs();
  };
}
