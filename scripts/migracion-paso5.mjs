// Migración del Paso 5 — MODO SIMULACIÓN (solo lectura).
// Lista los lotes y perfiles de Firestore que la migración modificaría, sin escribir nada.
//
// Uso (desde la carpeta del proyecto):
//   node scripts/migracion-paso5.mjs

import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, getDoc, getDocs, terminate } from 'firebase/firestore';

const GRANJA_ID_PREDETERMINADA = 'cultivos-lore';
const ADMIN_MASTER_EMAIL = 'carlosbs1579@gmail.com';

const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
const app = initializeApp(config);
const db = config.firestoreDatabaseId && config.firestoreDatabaseId !== '(default)'
  ? getFirestore(app, config.firestoreDatabaseId)
  : getFirestore(app);

function esPerfilSimulado(uid) {
  return uid === 'admin_carlos_master' || uid.startsWith('op_');
}

function esAdminMaestro(email) {
  return (email || '').trim().toLowerCase() === ADMIN_MASTER_EMAIL;
}

const [lotesSnap, usuariosSnap] = await Promise.all([
  getDocs(collection(db, 'lotes')),
  getDocs(collection(db, 'usuarios'))
]);

// Las reglas no permiten listar contadores; solo se lee el global
let contadorGlobal = '(no disponible)';
try {
  const snap = await getDoc(doc(db, 'contadores', 'lotes_global'));
  contadorGlobal = snap.exists() ? snap.data().valor : '(no existe)';
} catch (err) {
  contadorGlobal = `(sin permiso: ${err.code})`;
}

// ---------- Perfiles ----------
const perfiles = usuariosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const uidPorEmail = new Map(
  perfiles.filter((p) => !esPerfilSimulado(p.id)).map((p) => [(p.email || '').toLowerCase(), p.id])
);

console.log(`\n=== PERFILES (${perfiles.length} en usuarios/) ===`);
for (const p of perfiles) {
  const cambios = [];
  if (esPerfilSimulado(p.id)) {
    const real = uidPorEmail.get((p.email || '').toLowerCase());
    console.log(`- ${p.id} | ${p.email} | estado=${p.estado} -> SIMULADO (sin cuenta real). No se modifica ni se borra.${real ? ` Existe perfil real: ${real}` : ' No existe perfil real con ese correo.'}`);
    continue;
  }
  if (!p.rol) cambios.push(`rol: ${esAdminMaestro(p.email) ? 'admin' : 'operario'}`);
  if (!p.granjaId) cambios.push(`granjaId: ${GRANJA_ID_PREDETERMINADA}`);
  if (p.uid && p.uid !== p.id) cambios.push(`uid: ${p.id} (el campo uid no coincide con el documento: ${p.uid})`);
  console.log(`- ${p.id} | ${p.email} | rol=${p.rol ?? '(falta)'} | estado=${p.estado} | granjaId=${p.granjaId ?? '(falta)'} -> ${cambios.length ? 'AGREGAR ' + cambios.join(', ') : 'sin cambios'}`);
}

// ---------- Lotes ----------
const lotes = lotesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
console.log(`\n=== LOTES (${lotes.length} en lotes/) ===`);
let lotesAMigrar = 0;
for (const l of lotes) {
  const eventos = Array.isArray(l.eventos) ? l.eventos.length : 0;
  const uidCreador = uidPorEmail.get((l.creadoPor || '').toLowerCase());
  const base = `- ${l.id} | estado=${l.estado} | eventos=${eventos} | consecutivo=${l.consecutivo} | creadoPor=${l.creadoPor} | creadoEn=${l.creadoEn}`;
  if (l.granjaId) {
    console.log(`${base} | granjaId=${l.granjaId} -> sin cambios`);
    continue;
  }
  lotesAMigrar++;
  console.log(`${base} -> AGREGAR granjaId: ${GRANJA_ID_PREDETERMINADA}`);
  console.log(`    (informativo) creadoPorUid falta; UID del perfil real con ese correo: ${uidCreador ?? 'no hay perfil real'}`);
}

// ---------- Contadores ----------
// Un lote creado sin pasar por la transacción de Firestore deja los contadores atrasados; el
// siguiente lote repetiría su consecutivo o chocaría con su código. Se comparan con los lotes.
function letraANumero(letras) {
  return [...letras].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);
}

const maxConsecutivo = lotes.reduce((m, l) => Math.max(m, Number(l.consecutivo) || 0), 0);
const diariosNecesarios = new Map();
for (const l of lotes) {
  const partes = /^(\d{8})-([A-Z]+)-(.+)$/.exec(l.id);
  if (!partes) continue;
  const id = `diario_${partes[1]}_${partes[3]}`;
  diariosNecesarios.set(id, Math.max(diariosNecesarios.get(id) || 0, letraANumero(partes[2])));
}

console.log(`\n=== CONTADORES ===`);
const valorGlobal = typeof contadorGlobal === 'number' ? contadorGlobal : 0;
console.log(`- lotes_global: valor=${contadorGlobal} | mínimo necesario=${maxConsecutivo} -> ${valorGlobal >= maxConsecutivo ? 'sin cambios' : `FIJAR valor: ${maxConsecutivo}`}`);
for (const [id, necesario] of diariosNecesarios) {
  let actual;
  try {
    const snap = await getDoc(doc(db, 'contadores', id));
    actual = snap.exists() ? snap.data().valor : '(no existe)';
  } catch (err) {
    actual = `(sin permiso: ${err.code})`;
  }
  const valor = typeof actual === 'number' ? actual : 0;
  console.log(`- ${id}: valor=${actual} | mínimo necesario=${necesario} -> ${valor >= necesario ? 'sin cambios' : `FIJAR valor: ${necesario}`}`);
}

console.log(`\nResumen: ${lotesAMigrar} lote(s) recibirían granjaId. NO SE ESCRIBIÓ NADA.`);
await terminate(db);
process.exit(0);
