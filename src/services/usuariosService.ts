import { doc, getDoc, setDoc, updateDoc, collection, onSnapshot } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db } from '../firebase/firebaseConfig';
import { UsuarioPerfil, PermisosUsuario, RolUsuario, ADMIN_MASTER_EMAIL } from '../types';
import { GRANJA_ID_PREDETERMINADA } from '../utils/constants';

// Los perfiles operativos viven únicamente en Firestore, en usuarios/{uid}, donde uid es el UID
// real de Firebase Authentication. Ya no se usan copias en localStorage.

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

/**
 * Indica si un ID de documento corresponde a un perfil creado por las sesiones simuladas de
 * versiones anteriores (sin cuenta real en Firebase Authentication)
 */
function esPerfilSimulado(uid: string): boolean {
  return uid === 'admin_carlos_master' || uid.startsWith('op_');
}

/**
 * Completa en memoria los campos que los perfiles antiguos no tienen (rol, granjaId, permisos)
 */
function normalizarPerfil(data: Partial<UsuarioPerfil>, uid: string): UsuarioPerfil {
  const email = data.email || '';
  return {
    ...data,
    uid,
    email,
    rol: data.rol || (esAdminMaestro(email) ? 'admin' : 'operario'),
    granjaId: data.granjaId || GRANJA_ID_PREDETERMINADA,
    cargo: data.cargo || '',
    estado: data.estado || 'pendiente',
    permisos: { ...PERMISOS_DEFAULT_OPERARIO, ...(data.permisos || {}) },
    creadoEn: data.creadoEn || '',
    actualizadoEn: data.actualizadoEn || ''
  };
}

/**
 * Determina si el correo pertenece al Administrador Maestro (Carlos)
 */
export function esAdminMaestro(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === ADMIN_MASTER_EMAIL.toLowerCase();
}

/**
 * Indica si el perfil puede administrar usuarios y configuración de la granja
 */
export function esAdministrador(perfil: UsuarioPerfil | null): boolean {
  if (!perfil) return false;
  if (esAdminMaestro(perfil.email)) return true;
  return perfil.rol === 'admin' && perfil.estado === 'activo';
}

/**
 * Verifica si un perfil cuenta con un permiso específico
 */
export function verificarPermiso(
  perfil: UsuarioPerfil | null,
  permiso: keyof PermisosUsuario
): boolean {
  if (!perfil) return false;
  if (esAdministrador(perfil)) return true;
  if (perfil.estado !== 'activo' || perfil.rol === 'consulta') return false;
  return Boolean(perfil.permisos && perfil.permisos[permiso]);
}

/**
 * Obtiene o crea el perfil operativo del usuario autenticado. Un usuario nuevo queda
 * "pendiente" y sin permisos hasta que un administrador lo autorice.
 * Si Firestore no responde, se lanza el error: el usuario no recibe permisos supuestos.
 */
export async function sincronizarPerfilUsuario(user: User): Promise<UsuarioPerfil> {
  const userRef = doc(db, 'usuarios', user.uid);
  const esAdmin = esAdminMaestro(user.email);
  const fechaIso = new Date().toISOString();

  const snap = await getDoc(userRef);

  if (snap.exists()) {
    const perfil = normalizarPerfil(snap.data() as Partial<UsuarioPerfil>, user.uid);
    if (!esAdmin) return perfil;

    // El Administrador Maestro siempre conserva el rol de administrador y todos los permisos
    const perfilAdmin: UsuarioPerfil = {
      ...perfil,
      rol: 'admin',
      estado: 'activo',
      permisos: PERMISOS_DEFAULT_ADMIN,
      actualizadoEn: fechaIso
    };
    await updateDoc(userRef, {
      rol: perfilAdmin.rol,
      granjaId: perfilAdmin.granjaId,
      estado: perfilAdmin.estado,
      permisos: perfilAdmin.permisos,
      actualizadoEn: fechaIso
    });
    return perfilAdmin;
  }

  const nuevoPerfil: UsuarioPerfil = {
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || user.email?.split('@')[0] || (esAdmin ? 'Carlos' : 'Operario'),
    rol: esAdmin ? 'admin' : 'operario',
    granjaId: GRANJA_ID_PREDETERMINADA,
    cargo: esAdmin ? 'Administrador Principal / Propietario' : 'Operario en espera de asignación',
    estado: esAdmin ? 'activo' : 'pendiente',
    permisos: esAdmin ? PERMISOS_DEFAULT_ADMIN : PERMISOS_DEFAULT_OPERARIO,
    creadoEn: fechaIso,
    actualizadoEn: fechaIso,
    ...(esAdmin ? { autorizadoPor: ADMIN_MASTER_EMAIL } : {})
  };
  await setDoc(userRef, nuevoPerfil);
  return nuevoPerfil;
}

/**
 * Escucha en tiempo real los perfiles de usuario de la granja
 */
export function escucharUsuarios(
  onUpdate: (usuarios: UsuarioPerfil[]) => void,
  onError?: (error: any) => void,
  granjaId: string = GRANJA_ID_PREDETERMINADA
): () => void {
  return onSnapshot(
    collection(db, 'usuarios'),
    (snapshot) => {
      const lista: UsuarioPerfil[] = [];
      snapshot.forEach((d) => {
        // Los perfiles de sesiones simuladas no corresponden a ninguna cuenta real; no se muestran
        if (esPerfilSimulado(d.id)) return;
        const perfil = normalizarPerfil(d.data() as Partial<UsuarioPerfil>, d.id);
        if (perfil.granjaId === granjaId) {
          lista.push(perfil);
        }
      });
      lista.sort((a, b) => {
        if (esAdminMaestro(a.email)) return -1;
        if (esAdminMaestro(b.email)) return 1;
        return a.email.localeCompare(b.email);
      });
      onUpdate(lista);
    },
    (err) => {
      console.error('Error escuchando perfiles de usuario en Firestore:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Permite a un administrador modificar el rol, cargo, estado y permisos de un usuario
 */
export async function actualizarPerfilOperario(
  uid: string,
  datos: {
    rol: RolUsuario;
    cargo: string;
    estado: 'activo' | 'pendiente' | 'inactivo';
    permisos: PermisosUsuario;
  },
  adminEmail: string,
  granjaId: string = GRANJA_ID_PREDETERMINADA
): Promise<void> {
  // Un usuario de consulta no puede tener permisos de escritura; un administrador los tiene todos
  const permisos =
    datos.rol === 'consulta'
      ? PERMISOS_DEFAULT_OPERARIO
      : datos.rol === 'admin'
      ? PERMISOS_DEFAULT_ADMIN
      : datos.permisos;

  await updateDoc(doc(db, 'usuarios', uid), {
    rol: datos.rol,
    granjaId,
    cargo: datos.cargo.trim(),
    estado: datos.estado,
    permisos,
    autorizadoPor: adminEmail,
    actualizadoEn: new Date().toISOString()
  });
}
