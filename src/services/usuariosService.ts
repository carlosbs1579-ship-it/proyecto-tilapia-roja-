import { doc, getDoc, setDoc, updateDoc, collection, onSnapshot } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db } from '../firebase/firebaseConfig';
import { UsuarioPerfil, PermisosUsuario, ADMIN_MASTER_EMAIL } from '../types';

const USUARIOS_LOCAL_KEY = 'cultivos_lore_usuarios_db';

export const PERMISOS_DEFAULT_ADMIN: PermisosUsuario = {
  crearLotes: true,
  registrarEventos: true,
  cerrarLotes: true,
  gestionarEstanques: true,
  gestionarConfiguracion: true,
  administrarUsuarios: true,
};

export const PERMISOS_DEFAULT_OPERARIO: PermisosUsuario = {
  crearLotes: false,
  registrarEventos: false,
  cerrarLotes: false,
  gestionarEstanques: false,
  gestionarConfiguracion: false,
  administrarUsuarios: false,
};

type UsuariosListener = (usuarios: UsuarioPerfil[]) => void;
const listenersUsuarios: Set<UsuariosListener> = new Set();

export function getUsuariosLocales(): UsuarioPerfil[] {
  try {
    const raw = localStorage.getItem(USUARIOS_LOCAL_KEY);
    if (!raw) {
      // Pre-poblar al Administrador Maestro Carlos
      const adminCarlos: UsuarioPerfil = {
        uid: 'admin_carlos_master',
        email: ADMIN_MASTER_EMAIL,
        displayName: 'Carlos (Administrador Maestro)',
        cargo: 'Administrador Principal / Propietario',
        estado: 'activo',
        permisos: PERMISOS_DEFAULT_ADMIN,
        creadoEn: new Date().toISOString(),
        actualizadoEn: new Date().toISOString(),
        autorizadoPor: ADMIN_MASTER_EMAIL
      };
      return [adminCarlos];
    }
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function guardarUsuariosLocales(usuarios: UsuarioPerfil[]): void {
  try {
    localStorage.setItem(USUARIOS_LOCAL_KEY, JSON.stringify(usuarios));
  } catch {}
  listenersUsuarios.forEach((fn) => fn(usuarios));
}

/**
 * Determina si el correo pertenece al Administrador Maestro (Carlos)
 */
export function esAdminMaestro(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === ADMIN_MASTER_EMAIL.toLowerCase();
}

/**
 * Verifica si un perfil cuenta con un permiso específico
 */
export function verificarPermiso(
  perfil: UsuarioPerfil | null,
  permiso: keyof PermisosUsuario
): boolean {
  if (!perfil) return false;
  if (esAdminMaestro(perfil.email)) return true;
  if (perfil.estado !== 'activo') return false;
  return Boolean(perfil.permisos && perfil.permisos[permiso]);
}

/**
 * Sincroniza o crea el perfil del usuario al iniciar sesión
 */
export async function sincronizarPerfilUsuario(user: User): Promise<UsuarioPerfil> {
  const userRef = doc(db, 'usuarios', user.uid);
  const esAdmin = esAdminMaestro(user.email);
  const fechaIso = new Date().toISOString();

  let perfil: UsuarioPerfil = {
    uid: user.uid,
    email: user.email || 'operario@cultivoslore.com',
    displayName: user.displayName || user.email?.split('@')[0] || (esAdmin ? 'Carlos' : 'Operario'),
    cargo: esAdmin ? 'Administrador Principal / Propietario' : 'Operario en espera de asignación',
    estado: esAdmin ? 'activo' : 'pendiente',
    permisos: esAdmin ? PERMISOS_DEFAULT_ADMIN : PERMISOS_DEFAULT_OPERARIO,
    creadoEn: fechaIso,
    actualizadoEn: fechaIso,
    autorizadoPor: esAdmin ? ADMIN_MASTER_EMAIL : undefined
  };

  // 1. Guardar y recuperar de almacenamiento local
  const usuariosLocales = getUsuariosLocales();
  const existenteLocal = usuariosLocales.find((u) => u.uid === user.uid || u.email === user.email);
  if (existenteLocal) {
    perfil = {
      ...existenteLocal,
      uid: user.uid,
      // Si es Carlos, asegurar siempre permisos completos
      permisos: esAdmin ? PERMISOS_DEFAULT_ADMIN : existenteLocal.permisos,
      estado: esAdmin ? 'activo' : existenteLocal.estado,
      cargo: esAdmin ? (existenteLocal.cargo || 'Administrador Principal') : existenteLocal.cargo
    };
  }

  const listaActualizada = [
    perfil,
    ...usuariosLocales.filter((u) => u.uid !== perfil.uid && u.email !== perfil.email)
  ];
  guardarUsuariosLocales(listaActualizada);

  // 2. Intentar guardar en Firestore en segundo plano
  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, perfil);
    } else {
      if (esAdmin) {
        await updateDoc(userRef, {
          estado: 'activo',
          permisos: PERMISOS_DEFAULT_ADMIN,
          actualizadoEn: fechaIso
        });
      }
    }
  } catch (err) {
    console.warn('Perfil sincronizado localmente (Firestore no disponible):', err);
  }

  return perfil;
}

/**
 * Escucha la lista completa de perfiles de usuario en tiempo real
 */
export function escucharUsuarios(
  onUpdate: (usuarios: UsuarioPerfil[]) => void,
  onError?: (error: any) => void
): () => void {
  // Emitir de inmediato la lista local
  onUpdate(getUsuariosLocales());
  listenersUsuarios.add(onUpdate);

  const colRef = collection(db, 'usuarios');
  const unsubFs = onSnapshot(
    colRef,
    (snapshot) => {
      const listaFs: UsuarioPerfil[] = [];
      snapshot.forEach((d) => {
        listaFs.push(d.data() as UsuarioPerfil);
      });

      if (listaFs.length > 0) {
        const locales = getUsuariosLocales();
        const mapa = new Map<string, UsuarioPerfil>();
        locales.forEach((u) => mapa.set(u.email, u));
        listaFs.forEach((u) => mapa.set(u.email, u));

        const combinados = Array.from(mapa.values());
        combinados.sort((a, b) => {
          if (esAdminMaestro(a.email)) return -1;
          if (esAdminMaestro(b.email)) return 1;
          return a.email.localeCompare(b.email);
        });
        guardarUsuariosLocales(combinados);
      }
    },
    (err) => {
      console.warn('Firestore usuarios en modo contingencia local:', err?.message || err);
      onUpdate(getUsuariosLocales());
    }
  );

  return () => {
    listenersUsuarios.delete(onUpdate);
    unsubFs();
  };
}

/**
 * Permite a Carlos modificar el nombre de la posición, estado y permisos de un operario
 */
export async function actualizarPerfilOperario(
  uid: string,
  datos: {
    cargo: string;
    estado: 'activo' | 'pendiente' | 'inactivo';
    permisos: PermisosUsuario;
  },
  adminEmail: string
): Promise<void> {
  const usuariosLocales = getUsuariosLocales();
  const index = usuariosLocales.findIndex((u) => u.uid === uid);
  const fechaIso = new Date().toISOString();

  if (index !== -1) {
    usuariosLocales[index] = {
      ...usuariosLocales[index],
      cargo: datos.cargo.trim(),
      estado: datos.estado,
      permisos: datos.permisos,
      autorizadoPor: adminEmail,
      actualizadoEn: fechaIso
    };
    guardarUsuariosLocales(usuariosLocales);
  }

  // Intentar sincronizar en Firestore
  try {
    const userRef = doc(db, 'usuarios', uid);
    await updateDoc(userRef, {
      cargo: datos.cargo.trim(),
      estado: datos.estado,
      permisos: datos.permisos,
      autorizadoPor: adminEmail,
      actualizadoEn: fechaIso
    });
  } catch (error) {
    console.warn('Permisos de operario actualizados localmente:', error);
  }
}
