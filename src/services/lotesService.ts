import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  where
} from 'firebase/firestore';
import { auth, db } from '../firebase/firebaseConfig';
import { Lote, EventoLote, TipoEvento, ConfiguracionGeneral } from '../types';
import {
  PRODUCTO_FIJO,
  MODALIDAD_FIJA,
  ORIGEN_FIJO,
  GRANJA_ID_PREDETERMINADA,
  compactarFecha,
  getFechaHoyBogota
} from '../utils/constants';
import { calcularHashEvento, HASH_GENESIS } from './hashService';
import { recalcularResumenLote } from './calculosService';
import { generarYSubirPdfLote } from './pdfService';
import { construirUrlPublicaPdf, construirUrlPublicaTrazabilidad } from './qrService';

// Firestore es la única fuente de verdad de los lotes. Ya no se leen ni se escriben copias en
// localStorage: esas copias no se compartían entre usuarios y, al resincronizarse, pisaban los
// eventos registrados por otros. Los datos antiguos que existan en localStorage no se borran.

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

/**
 * Traduce un error de Firestore a un mensaje comprensible para el operario
 */
function mensajeErrorFirestore(accion: string, err: any): Error {
  const codigo = err?.code || '';
  if (codigo === 'permission-denied') {
    return new Error(`No tienes permiso para ${accion} en la base de datos de la granja.`);
  }
  if (codigo === 'unavailable' || codigo === 'deadline-exceeded') {
    return new Error(`No hay conexión con la base de datos. No fue posible ${accion}; intenta de nuevo cuando tengas internet.`);
  }
  return new Error(err?.message || `No fue posible ${accion}.`);
}

function generarIdEvento(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `ev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
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
  granjaId?: string;
}

/**
 * Crea un nuevo lote con garantía de inalterabilidad y cálculo atómico de consecutivo
 * mediante una transacción de Firestore. Si la transacción falla, se informa el error
 * en lugar de crear una copia local que los demás usuarios no verían.
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
    config,
    granjaId = GRANJA_ID_PREDETERMINADA
  } = params;

  const fechaCompacta = compactarFecha(fechaSiembra);
  const globalCounterRef = doc(db, 'contadores', 'lotes_global');
  const diarioCounterRef = doc(db, 'contadores', `diario_${fechaCompacta}_${estanque}`);
  const creadoPorUid = auth.currentUser?.uid || null;

  try {
    return await runTransaction(db, async (transaction) => {
      const globalSnap = await transaction.get(globalCounterRef);
      const diarioSnap = await transaction.get(diarioCounterRef);

      const nuevoConsecutivoGlobal = (globalSnap.exists() ? Number(globalSnap.data()?.valor || 0) : 0) + 1;
      const nuevoConsecutivoDiario = (diarioSnap.exists() ? Number(diarioSnap.data()?.valor || 0) : 0) + 1;

      const letra = obtenerLetraConsecutiva(nuevoConsecutivoDiario);
      const codigoGenerado = `${fechaCompacta}-${letra}-${estanque}`;

      const loteDocRef = doc(db, 'lotes', codigoGenerado);
      const loteSnap = await transaction.get(loteDocRef);
      if (loteSnap.exists()) {
        throw new Error(`El código de lote ${codigoGenerado} ya existe en el sistema.`);
      }

      const fechaIsoAhora = new Date().toISOString();
      const descripcionSiembra = observaciones?.trim() || 'Siembra inicial del lote en estanque ' + estanque;

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
        descripcion: descripcionSiembra,
        datos: datosSiembra,
        registradoPor: userEmail,
        registradoEn: fechaIsoAhora,
        hashAnterior: HASH_GENESIS
      });

      const primerEvento: EventoLote = {
        id: generarIdEvento(),
        indice: 0,
        tipo: 'Siembra',
        fechaEvento: fechaSiembra,
        descripcion: descripcionSiembra,
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
        granjaId,
        creadoPor: userEmail,
        creadoPorUid,
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
  } catch (err: any) {
    console.error('Error creando lote en Firestore:', err);
    throw mensajeErrorFirestore('crear el lote', err);
  }
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
 * Agrega un nuevo evento a la cadena inalterable, calculando el hash SHA-256.
 * La transacción lee la versión vigente del lote en Firestore, de modo que los eventos
 * registrados al mismo tiempo por otros usuarios no se pierden.
 */
export async function registrarEventoEnLote(params: ParamsAgregarEvento): Promise<Lote> {
  const { codigoLote, tipo, fechaEvento, descripcion, datos, userEmail, config } = params;
  const loteRef = doc(db, 'lotes', codigoLote);

  let loteActualizado: Lote;
  try {
    loteActualizado = await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(loteRef);
      if (!snap.exists()) {
        throw new Error(`El lote ${codigoLote} no existe en la base de datos de la granja.`);
      }
      const lote = snap.data() as Lote;

      const eventosActuales = lote.eventos || [];
      const nuevoIndice = eventosActuales.length;
      const hashAnterior = nuevoIndice === 0 ? HASH_GENESIS : eventosActuales[nuevoIndice - 1].hash;

      const fechaIsoAhora = new Date().toISOString();

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
        id: generarIdEvento(),
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
  } catch (err: any) {
    console.error('Error registrando evento en Firestore:', err);
    throw mensajeErrorFirestore('registrar el evento', err);
  }

  // Si el lote ya estaba cerrado, regenerar PDF
  if (loteActualizado.estado === 'cerrado') {
    generarYSubirPdfLote(loteActualizado, config).catch((err) => console.warn('Regeneración PDF:', err));
  }

  return loteActualizado;
}

/**
 * Cierra un lote productivo, actualiza su estado en Firestore y genera el certificado PDF
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

  let loteCerrado: Lote;
  try {
    loteCerrado = await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(loteRef);
      if (!snap.exists()) {
        throw new Error(`El lote ${codigoLimpio} no fue encontrado para proceder con el cierre.`);
      }
      const loteBase = snap.data() as Lote;

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

      // Solo se actualizan los campos del cierre; los eventos no se reescriben
      const patch: Partial<Lote> = {
        estado: 'cerrado',
        fechaCierre,
        resumen: nuevoResumen,
        pdfPath: `lotes/${codigoLimpio}.pdf`,
        pdfUrl: construirUrlPublicaTrazabilidad(codigoLimpio),
        versionPdf: (loteBase.versionPdf || 0) + 1,
        pdfActualizadoEn: fechaIsoAhora,
        actualizadoEn: fechaIsoAhora
      };

      transaction.update(loteRef, patch);

      return { ...loteBase, ...patch } as Lote;
    });
  } catch (err: any) {
    console.error('Error cerrando lote en Firestore:', err);
    throw mensajeErrorFirestore('cerrar el lote', err);
  }

  // Generar el PDF y subirlo a Storage de fondo (con timeout de protección para nunca colgar la UI)
  generarYSubirPdfLote(loteCerrado, config).catch((pdfErr) => {
    console.warn('Generación de PDF en segundo plano:', pdfErr);
  });

  return loteCerrado;
}

/**
 * Escucha en tiempo real todos los lotes de la granja, sin importar quién los creó.
 * El filtro por granjaId es obligatorio para que las reglas de seguridad permitan la consulta.
 * Los lotes antiguos sin granjaId no aparecen hasta que se migren.
 */
export function escucharLotes(
  onUpdate: (lotes: Lote[]) => void,
  onError?: (error: any) => void,
  granjaId: string = GRANJA_ID_PREDETERMINADA
): () => void {
  return onSnapshot(
    query(collection(db, 'lotes'), where('granjaId', '==', granjaId)),
    (snapshot) => {
      const lista: Lote[] = [];
      snapshot.forEach((docSnap) => {
        lista.push(docSnap.data() as Lote);
      });
      lista.sort((a, b) => (b.consecutivo || 0) - (a.consecutivo || 0));
      onUpdate(lista);
    },
    (error) => {
      console.error('Error escuchando lotes en Firestore:', error);
      if (onError) onError(error);
    }
  );
}

/**
 * Escucha un lote individual en tiempo real
 */
export function escucharLoteIndividual(
  codigoLote: string,
  onUpdate: (lote: Lote | null) => void,
  onError?: (error: any) => void
): () => void {
  return onSnapshot(
    doc(db, 'lotes', codigoLote),
    (snap) => {
      onUpdate(snap.exists() ? (snap.data() as Lote) : null);
    },
    (error) => {
      console.error(`Error escuchando el lote ${codigoLote} en Firestore:`, error);
      if (onError) onError(error);
    }
  );
}
