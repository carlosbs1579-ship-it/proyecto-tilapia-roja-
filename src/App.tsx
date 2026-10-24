import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import { auth, db } from './firebase/firebaseConfig';
import { Lote, ConfiguracionGeneral, UsuarioPerfil, ADMIN_MASTER_EMAIL } from './types';
import { CONFIG_DEFAULT } from './utils/constants';
import { escucharConfiguracion } from './services/configService';
import { escucharLotes } from './services/lotesService';
import { sincronizarPerfilUsuario, esAdminMaestro } from './services/usuariosService';

import { Navbar } from './components/Navbar';
import { DashboardTab } from './components/DashboardTab';
import { LotesTab } from './components/LotesTab';
import { AnaliticaTab } from './components/AnaliticaTab';
import { ConfiguracionTab } from './components/ConfiguracionTab';
import { AuthModal } from './components/AuthModal';
import { NuevoLoteModal } from './components/NuevoLoteModal';
import { LoteDetailModal } from './components/LoteDetailModal';
import { QrModal } from './components/QrModal';
import { PublicTraceabilityView } from './components/PublicTraceabilityView';
import { AlertCircle, Lock, Crown, ShieldAlert } from 'lucide-react';

const SESION_STORAGE_KEY = 'cultivos_lore_sesion_activa';

interface UsuarioSesion {
  uid: string;
  email: string;
  displayName: string;
}

export default function App() {
  const [tabActiva, setTabActiva] = useState<'inicio' | 'lotes' | 'analitica' | 'configuracion'>('inicio');

  // Si se ingresó mediante escaneo de QR (con parámetro ?lote=...), mostrar vista pública
  const [lotePublicoCodigo, setLotePublicoCodigo] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('lote');
    }
    return null;
  });

  // Inicializar con la sesión activa persistida o Carlos por defecto
  const [usuario, setUsuario] = useState<User | UsuarioSesion | null>(() => {
    try {
      const sesionGuardada = localStorage.getItem(SESION_STORAGE_KEY);
      if (sesionGuardada) {
        return JSON.parse(sesionGuardada);
      }
    } catch {}
    // Si es Carlos, inicializar por defecto para acceso inmediato sin bloqueos
    return {
      uid: 'admin_carlos_master',
      email: ADMIN_MASTER_EMAIL,
      displayName: 'Carlos (Administrador Maestro)'
    };
  });

  const [perfilUsuario, setPerfilUsuario] = useState<UsuarioPerfil | null>(null);
  const [authCargando, setAuthCargando] = useState(false);

  const [config, setConfig] = useState<ConfiguracionGeneral>(CONFIG_DEFAULT);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [lotesCargando, setLotesCargando] = useState(true);
  const [errorConexion, setErrorConexion] = useState<string | null>(null);

  // Modales
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [nuevoLoteModalOpen, setNuevoLoteModalOpen] = useState(false);
  const [loteDetalle, setLoteDetalle] = useState<Lote | null>(null);
  const [loteQr, setLoteQr] = useState<Lote | null>(null);

  const esAdmin = esAdminMaestro(usuario?.email);

  // 1. Probar conexión Firestore al inicio según Skill
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error('Please check your Firebase configuration.');
        }
      }
    }
    testConnection();
  }, []);

  // 2. Escuchar cambios de autenticación oficial de Firebase
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        const u = {
          uid: fbUser.uid,
          email: fbUser.email || '',
          displayName: fbUser.displayName || fbUser.email?.split('@')[0] || ''
        };
        setUsuario(u);
        try {
          localStorage.setItem(SESION_STORAGE_KEY, JSON.stringify(u));
          const perfil = await sincronizarPerfilUsuario(fbUser);
          setPerfilUsuario(perfil);
        } catch (err) {
          console.warn('Sincronización perfil:', err);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Sincronizar perfil cuando cambia el usuario (sea de Firebase o manual)
  useEffect(() => {
    if (usuario) {
      sincronizarPerfilUsuario(usuario as User)
        .then((p) => setPerfilUsuario(p))
        .catch(console.warn);
    } else {
      setPerfilUsuario(null);
    }
  }, [usuario?.email]);

  // 3. Escuchar configuración en tiempo real
  useEffect(() => {
    const unsubConfig = escucharConfiguracion(
      (nuevaConfig) => {
        if (nuevaConfig) {
          setConfig(nuevaConfig);
        }
      },
      (err) => {
        console.warn('Error escuchando configuración:', err);
      }
    );
    return () => unsubConfig();
  }, []);

  // 4. Escuchar lotes en tiempo real
  useEffect(() => {
    setLotesCargando(true);
    const unsubLotes = escucharLotes(
      (listaLotes) => {
        setLotes(listaLotes);
        setLotesCargando(false);
        setErrorConexion(null);

        // Si hay un lote abierto en detalle, mantenerlo actualizado en vivo
        if (loteDetalle) {
          const actualizado = listaLotes.find((l) => l.codigo === loteDetalle.codigo);
          if (actualizado) {
            setLoteDetalle(actualizado);
          }
        }
      },
      (err) => {
        console.warn('Error escuchando lotes en Firestore:', err);
        setLotesCargando(false);
        setErrorConexion(
          err?.code === 'permission-denied'
            ? 'No tienes permiso para consultar los lotes de la granja.'
            : 'No fue posible conectar con la base de datos de lotes. Los datos mostrados pueden estar desactualizados.'
        );
      }
    );

    return () => unsubLotes();
  }, [usuario]);

  const handleCerrarSesion = async () => {
    try {
      localStorage.removeItem(SESION_STORAGE_KEY);
      await signOut(auth);
    } catch {}
    setUsuario(null);
    setPerfilUsuario(null);
  };

  const handleLoginManual = (userSession: UsuarioSesion) => {
    setUsuario(userSession);
    try {
      localStorage.setItem(SESION_STORAGE_KEY, JSON.stringify(userSession));
    } catch {}
    sincronizarPerfilUsuario(userSession as any)
      .then((p) => setPerfilUsuario(p))
      .catch(console.warn);
  };

  const handleAbrirNuevoLote = () => {
    if (!usuario) {
      setAuthModalOpen(true);
      return;
    }
    setNuevoLoteModalOpen(true);
  };

  const handleLoteCreado = (nuevoLote: Lote) => {
    setLoteDetalle(nuevoLote);
  };

  // Si se detectó un código de lote por escaneo de QR en la URL, mostrar vista pública interactiva
  if (lotePublicoCodigo) {
    return (
      <PublicTraceabilityView
        codigoLote={lotePublicoCodigo}
        config={config}
        onVolverAlPanel={() => {
          if (typeof window !== 'undefined') {
            window.history.pushState({}, '', window.location.pathname);
          }
          setLotePublicoCodigo(null);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans">
      {/* NAVBAR */}
      <Navbar
        tabActiva={tabActiva}
        setTabActiva={setTabActiva}
        usuario={usuario as User}
        perfilUsuario={perfilUsuario}
        onAbrirAuth={() => setAuthModalOpen(true)}
        onCerrarSesion={handleCerrarSesion}
        onNuevoLote={handleAbrirNuevoLote}
      />

      {/* BANNER 1: SI NO HA INICIADO SESIÓN */}
      {!usuario && !authCargando && (
        <div className="bg-sky-950 text-sky-100 px-4 py-2.5 text-xs border-b border-sky-800">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
            <div className="flex items-center space-x-2">
              <Lock className="w-4 h-4 text-sky-400 shrink-0" />
              <span>
                <strong>Modo Consulta:</strong> Para crear lotes o registrar eventos debes ingresar. Carlos (<strong>carlosbs1579@gmail.com</strong>) tiene acceso de Administrador Maestro.
              </span>
            </div>
            <button
              onClick={() => setAuthModalOpen(true)}
              className="px-3.5 py-1 bg-sky-500 hover:bg-sky-400 text-white font-semibold rounded-md shadow-xs transition-colors shrink-0"
            >
              Ingresar al sistema
            </button>
          </div>
        </div>
      )}

      {/* BANNER 2: SESIÓN DE ADMINISTRADOR MAESTRO (CARLOS) */}
      {usuario && esAdmin && (
        <div className="bg-amber-500/10 border-b border-amber-400/30 px-4 py-2 text-xs text-amber-900">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Crown className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>Sesión Administrador Maestro (Carlos):</strong> Tienes control total en Cultivos Loré. Puedes crear lotes, registrar eventos y otorgar cargos y permisos a operarios en <strong>"Configuración & Permisos"</strong>.
              </span>
            </div>
            <button
              onClick={() => setTabActiva('configuracion')}
              className="text-amber-800 hover:text-amber-950 underline font-semibold text-[11px] shrink-0 ml-2"
            >
              Gestionar Operarios
            </button>
          </div>
        </div>
      )}

      {/* BANNER 3: SI EL USUARIO ESTÁ PENDIENTE DE APROBACIÓN */}
      {usuario && !esAdmin && perfilUsuario?.estado === 'pendiente' && (
        <div className="bg-amber-50 border-b border-amber-300 px-4 py-2 text-xs text-amber-900">
          <div className="max-w-7xl mx-auto flex items-center space-x-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Perfil Pendiente:</strong> Tu cuenta ({usuario.email}) ha sido registrada pero aún no ha sido autorizada por Carlos (<strong>carlosbs1579@gmail.com</strong>). Tan pronto Carlos te asigne tu posición y permisos en la web, podrás crear lotes y cargar mediciones.
            </span>
          </div>
        </div>
      )}

      {/* ERROR DE CONEXIÓN */}
      {errorConexion && (
        <div className="bg-red-600 text-white px-4 py-2 text-xs flex items-center justify-center space-x-2">
          <AlertCircle className="w-4 h-4" />
          <span>{errorConexion}</span>
        </div>
      )}

      {/* CONTENIDO PRINCIPAL SEGÚN PESTAÑA */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {tabActiva === 'inicio' && (
          <DashboardTab
            lotes={lotes}
            config={config}
            onNuevoLote={handleAbrirNuevoLote}
            onSeleccionarLote={(lote) => setLoteDetalle(lote)}
            onAbrirQr={(lote) => setLoteQr(lote)}
          />
        )}

        {tabActiva === 'lotes' && (
          <LotesTab
            lotes={lotes}
            config={config}
            onNuevoLote={handleAbrirNuevoLote}
            onSeleccionarLote={(lote) => setLoteDetalle(lote)}
            onAbrirQr={(lote) => setLoteQr(lote)}
          />
        )}

        {tabActiva === 'analitica' && (
          <AnaliticaTab
            lotes={lotes}
            config={config}
            onSeleccionarLote={(lote) => setLoteDetalle(lote)}
          />
        )}

        {tabActiva === 'configuracion' && (
          <ConfiguracionTab
            config={config}
            userEmail={usuario?.email || ADMIN_MASTER_EMAIL}
            perfilActual={perfilUsuario}
            onConfigActualizada={(nuevaConfig) => setConfig(nuevaConfig)}
          />
        )}
      </main>

      {/* FOOTER */}
      <footer className="bg-slate-900 text-slate-400 border-t border-slate-800 py-6 text-xs text-center">
        <div className="max-w-7xl mx-auto px-4">
          <p className="font-semibold text-slate-300">
            Cultivos Loré — Granja de Tilapia Roja en Turbaco (Bolívar, Colombia)
          </p>
          <p className="text-slate-500 mt-1">
            Producto: Tilapia roja entera fresca, limpia (escamada y eviscerada), calibre 450 a 500 g • Modalidad Tilapia Pro
          </p>
          <p className="text-[11px] text-slate-500 mt-2">
            Este registro documenta cómo se produjo y manejó el lote; no reemplaza los controles de inocuidad.
          </p>
        </div>
      </footer>

      {/* MODALES */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onLoginManual={handleLoginManual}
      />

      {usuario && (
        <NuevoLoteModal
          isOpen={nuevoLoteModalOpen}
          onClose={() => setNuevoLoteModalOpen(false)}
          config={config}
          userEmail={usuario.email || ADMIN_MASTER_EMAIL}
          perfilActual={perfilUsuario}
          onLoteCreado={handleLoteCreado}
        />
      )}

      {loteDetalle && (
        <LoteDetailModal
          isOpen={Boolean(loteDetalle)}
          onClose={() => setLoteDetalle(null)}
          loteInicial={loteDetalle}
          config={config}
          userEmail={usuario?.email || ADMIN_MASTER_EMAIL}
          perfilActual={perfilUsuario}
          onLoteActualizado={(loteActualizado) => setLoteDetalle(loteActualizado)}
          onAbrirVistaPublica={(codigo) => {
            setLoteDetalle(null);
            setLotePublicoCodigo(codigo);
            if (typeof window !== 'undefined') {
              window.history.pushState({}, '', `/?lote=${encodeURIComponent(codigo)}`);
            }
          }}
        />
      )}

      {loteQr && (
        <QrModal
          isOpen={Boolean(loteQr)}
          onClose={() => setLoteQr(null)}
          lote={loteQr}
          config={config}
          onAbrirVistaPublica={(codigo) => {
            setLoteQr(null);
            setLotePublicoCodigo(codigo);
            if (typeof window !== 'undefined') {
              window.history.pushState({}, '', `/?lote=${encodeURIComponent(codigo)}`);
            }
          }}
        />
      )}
    </div>
  );
}
