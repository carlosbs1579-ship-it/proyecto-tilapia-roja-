import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/firebaseConfig';
import { ConfiguracionGeneral } from '../types';
import { CONFIG_DEFAULT } from '../utils/constants';

const CONFIG_LOCAL_KEY = 'cultivos_lore_config_local';

function getConfigLocal(): ConfiguracionGeneral {
  try {
    const raw = localStorage.getItem(CONFIG_LOCAL_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return CONFIG_DEFAULT;
}

function guardarConfigLocal(config: ConfiguracionGeneral): void {
  try {
    localStorage.setItem(CONFIG_LOCAL_KEY, JSON.stringify(config));
  } catch {}
}

/**
 * Obtiene la configuración general con fallback local resiliente
 */
export async function getConfiguracion(): Promise<ConfiguracionGeneral> {
  try {
    const configDocRef = doc(db, 'configuracion', 'general');
    const snap = await getDoc(configDocRef);
    if (snap.exists()) {
      const data = snap.data() as ConfiguracionGeneral;
      guardarConfigLocal(data);
      return data;
    }
  } catch (error) {
    console.warn('Configuración Firestore en modo local:', error);
  }
  return getConfigLocal();
}

/**
 * Suscribe un listener en tiempo real para cambios de configuración
 */
export function escucharConfiguracion(
  onUpdate: (config: ConfiguracionGeneral) => void,
  onError?: (error: any) => void
): () => void {
  // Emitir valor inicial local
  onUpdate(getConfigLocal());

  const configDocRef = doc(db, 'configuracion', 'general');
  return onSnapshot(
    configDocRef,
    (snap) => {
      if (snap.exists()) {
        const data = snap.data() as ConfiguracionGeneral;
        guardarConfigLocal(data);
        onUpdate(data);
      }
    },
    (error) => {
      console.warn('Firestore onSnapshot configuracion (usando configuración local):', error?.message || error);
      onUpdate(getConfigLocal());
    }
  );
}

/**
 * Actualiza la configuración general en Firestore y almacena localmente
 */
export async function guardarConfiguracion(
  config: ConfiguracionGeneral,
  userEmail: string
): Promise<void> {
  const payload: ConfiguracionGeneral = {
    ...config,
    actualizadoPor: userEmail,
    actualizadoEn: new Date().toISOString()
  };

  // Guardar en Firestore primero: si falla, el error llega a la pantalla en lugar de quedar
  // guardado solo en este navegador, donde los demás usuarios no lo verían
  const configDocRef = doc(db, 'configuracion', 'general');
  await setDoc(configDocRef, payload, { merge: true });
  guardarConfigLocal(payload);
}
