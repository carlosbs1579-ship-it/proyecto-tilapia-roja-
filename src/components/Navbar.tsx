import React from 'react';
import { Fish, ShieldCheck, LogIn, LogOut, User as UserIcon, Plus, Crown, AlertCircle } from 'lucide-react';
import { User } from 'firebase/auth';
import { UsuarioPerfil } from '../types';
import { esAdminMaestro } from '../services/usuariosService';

interface NavbarProps {
  tabActiva: 'inicio' | 'lotes' | 'analitica' | 'configuracion';
  setTabActiva: (tab: 'inicio' | 'lotes' | 'analitica' | 'configuracion') => void;
  usuario: User | null;
  perfilUsuario: UsuarioPerfil | null;
  onAbrirAuth: () => void;
  onCerrarSesion: () => void;
  onNuevoLote: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  tabActiva,
  setTabActiva,
  usuario,
  perfilUsuario,
  onAbrirAuth,
  onCerrarSesion,
  onNuevoLote
}) => {
  const esAdmin = esAdminMaestro(usuario?.email);
  const puedeCrear = esAdmin || Boolean(perfilUsuario?.estado === 'activo' && perfilUsuario?.permisos?.crearLotes);

  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo y Nombre de la Granja */}
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setTabActiva('inicio')}>
            <div className="w-10 h-10 rounded-lg bg-sky-600 flex items-center justify-center shadow-inner">
              <Fish className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg tracking-tight">Cultivos Loré</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30">
                  Tilapia Pro
                </span>
              </div>
              <p className="text-xs text-slate-400">Turbaco, Bolívar • Trazabilidad Inalterable</p>
            </div>
          </div>

          {/* Navegación por pestañas */}
          <nav className="hidden md:flex items-center space-x-1">
            <button
              onClick={() => setTabActiva('inicio')}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                tabActiva === 'inicio'
                  ? 'bg-slate-800 text-sky-400 border-b-2 border-sky-400'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              Inicio
            </button>
            <button
              onClick={() => setTabActiva('lotes')}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                tabActiva === 'lotes'
                  ? 'bg-slate-800 text-sky-400 border-b-2 border-sky-400'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              Lotes
            </button>
            <button
              onClick={() => setTabActiva('analitica')}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                tabActiva === 'analitica'
                  ? 'bg-slate-800 text-sky-400 border-b-2 border-sky-400'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              Analítica
            </button>
            <button
              onClick={() => setTabActiva('configuracion')}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                tabActiva === 'configuracion'
                  ? 'bg-slate-800 text-sky-400 border-b-2 border-sky-400'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              Configuración & Permisos
            </button>
          </nav>

          {/* Acciones de usuario y nuevo lote */}
          <div className="flex items-center space-x-3">
            {usuario ? (
              <>
                <button
                  onClick={onNuevoLote}
                  title={puedeCrear ? 'Registrar nuevo lote' : 'Requiere autorización para crear lotes'}
                  className={`inline-flex items-center space-x-1.5 px-3 py-1.5 text-sm font-medium rounded-md shadow-sm transition-colors ${
                    puedeCrear
                      ? 'bg-sky-600 hover:bg-sky-500 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">Nuevo lote</span>
                </button>

                <div className="flex items-center space-x-2 pl-2 border-l border-slate-700">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    esAdmin ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-slate-700 text-slate-300'
                  }`}>
                    {esAdmin ? <Crown className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
                  </div>
                  <div className="hidden lg:block text-left text-xs">
                    <p className="font-semibold text-slate-200 truncate max-w-[150px]">{usuario.email}</p>
                    <p className={`text-[10px] flex items-center truncate max-w-[150px] ${
                      esAdmin
                        ? 'text-amber-400 font-bold'
                        : perfilUsuario?.estado === 'activo'
                        ? 'text-emerald-400'
                        : 'text-amber-400'
                    }`}>
                      {esAdmin ? (
                        <>Administrador Maestro</>
                      ) : perfilUsuario?.estado === 'activo' ? (
                        <>{perfilUsuario.cargo || 'Operario Activo'}</>
                      ) : (
                        <>En espera de Carlos</>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={onCerrarSesion}
                    title="Cerrar sesión"
                    className="p-1.5 text-slate-400 hover:text-red-400 rounded-md hover:bg-slate-800 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              </>
            ) : (
              <button
                onClick={onAbrirAuth}
                className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 text-sm font-medium rounded-md bg-sky-600 hover:bg-sky-500 text-white shadow-sm transition-colors"
              >
                <LogIn className="w-4 h-4" />
                <span>Ingresar</span>
              </button>
            )}
          </div>
        </div>

        {/* Navegación móvil */}
        <div className="md:hidden flex border-t border-slate-800 py-2 space-x-1 overflow-x-auto">
          <button
            onClick={() => setTabActiva('inicio')}
            className={`px-3 py-1 text-xs rounded font-medium whitespace-nowrap ${tabActiva === 'inicio' ? 'bg-sky-600 text-white' : 'text-slate-300'}`}
          >
            Inicio
          </button>
          <button
            onClick={() => setTabActiva('lotes')}
            className={`px-3 py-1 text-xs rounded font-medium whitespace-nowrap ${tabActiva === 'lotes' ? 'bg-sky-600 text-white' : 'text-slate-300'}`}
          >
            Lotes
          </button>
          <button
            onClick={() => setTabActiva('analitica')}
            className={`px-3 py-1 text-xs rounded font-medium whitespace-nowrap ${tabActiva === 'analitica' ? 'bg-sky-600 text-white' : 'text-slate-300'}`}
          >
            Analítica
          </button>
          <button
            onClick={() => setTabActiva('configuracion')}
            className={`px-3 py-1 text-xs rounded font-medium whitespace-nowrap ${tabActiva === 'configuracion' ? 'bg-sky-600 text-white' : 'text-slate-300'}`}
          >
            Configuración & Permisos
          </button>
        </div>
      </div>
    </header>
  );
};
