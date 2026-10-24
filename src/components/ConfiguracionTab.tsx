import React, { useState, useEffect } from 'react';
import {
  Settings,
  Plus,
  Trash2,
  Save,
  CheckCircle,
  AlertCircle,
  Droplets,
  Apple,
  ShieldCheck,
  UserCheck,
  UserX,
  Clock,
  Shield,
  User as UserIcon,
  Check,
  Lock
} from 'lucide-react';
import { ConfiguracionGeneral, EstanqueConfig, UsuarioPerfil, PermisosUsuario, ADMIN_MASTER_EMAIL } from '../types';
import { guardarConfiguracion } from '../services/configService';
import {
  esAdminMaestro,
  escucharUsuarios,
  actualizarPerfilOperario
} from '../services/usuariosService';

interface ConfiguracionTabProps {
  config: ConfiguracionGeneral;
  userEmail: string;
  perfilActual: UsuarioPerfil | null;
  onConfigActualizada: (nuevaConfig: ConfiguracionGeneral) => void;
}

export const ConfiguracionTab: React.FC<ConfiguracionTabProps> = ({
  config,
  userEmail,
  perfilActual,
  onConfigActualizada
}) => {
  const esAdmin = esAdminMaestro(userEmail);

  // Estado local para edición de configuración general
  const [estanques, setEstanques] = useState<EstanqueConfig[]>(config.estanques || []);
  const [rangos, setRangos] = useState(config.rangosReferencia);
  const [ficha, setFicha] = useState(config.fichaNutricional);

  // Nuevo estanque form
  const [nuevoCodigo, setNuevoCodigo] = useState('');
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoVolumen, setNuevoVolumen] = useState<number | ''>(250);

  const [guardando, setGuardando] = useState(false);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Lista de usuarios en tiempo real para Carlos
  const [usuarios, setUsuarios] = useState<UsuarioPerfil[]>([]);
  const [usuariosCargando, setUsuariosCargando] = useState(true);

  // Estado para edición en línea de cargos y permisos de operarios
  const [edicionUsuarios, setEdicionUsuarios] = useState<
    Record<string, { cargo: string; estado: 'activo' | 'pendiente' | 'inactivo'; permisos: PermisosUsuario }>
  >({});
  const [guardandoUsuarioId, setGuardandoUsuarioId] = useState<string | null>(null);
  const [mensajeUsuarioExito, setMensajeUsuarioExito] = useState<string | null>(null);

  // Formulario para pre-registrar o invitar operario por correo
  const [invitarEmail, setInvitarEmail] = useState('');
  const [invitarCargo, setInvitarCargo] = useState('Técnico de Alimentación y Biometría');

  // Escuchar usuarios si es admin
  useEffect(() => {
    if (!esAdmin) return;
    setUsuariosCargando(true);
    const unsubscribe = escucharUsuarios(
      (lista) => {
        setUsuarios(lista);
        setUsuariosCargando(false);
        // Inicializar mapa de edición
        const mapa: Record<string, { cargo: string; estado: 'activo' | 'pendiente' | 'inactivo'; permisos: PermisosUsuario }> = {};
        for (const u of lista) {
          mapa[u.uid] = {
            cargo: u.cargo || '',
            estado: u.estado,
            permisos: { ...u.permisos }
          };
        }
        setEdicionUsuarios(mapa);
      },
      (err) => {
        console.warn('Error al escuchar perfiles de usuarios:', err);
        setUsuariosCargando(false);
      }
    );
    return () => unsubscribe();
  }, [esAdmin]);

  const handleAgregarEstanque = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const codigoLimpio = nuevoCodigo.trim().toUpperCase();
    if (!codigoLimpio) {
      setErrorMsg('El código del estanque es requerido (ej: E3).');
      return;
    }
    if (estanques.some((est) => est.codigo === codigoLimpio)) {
      setErrorMsg(`El estanque con código ${codigoLimpio} ya existe.`);
      return;
    }

    const nuevo: EstanqueConfig = {
      codigo: codigoLimpio,
      nombre: nuevoNombre.trim() || `Estanque ${codigoLimpio}`,
      volumenM3: nuevoVolumen === '' ? undefined : Number(nuevoVolumen)
    };

    setEstanques([...estanques, nuevo]);
    setNuevoCodigo('');
    setNuevoNombre('');
    setNuevoVolumen(250);
  };

  const handleEliminarEstanque = (codigo: string) => {
    if (estanques.length <= 1) {
      setErrorMsg('Debe existir al menos un estanque configurado.');
      return;
    }
    setEstanques(estanques.filter((e) => e.codigo !== codigo));
  };

  const handleGuardarTodo = async () => {
    setErrorMsg(null);
    setMensajeExito(null);
    setGuardando(true);

    try {
      const nuevaConfig: ConfiguracionGeneral = {
        estanques,
        rangosReferencia: rangos,
        fichaNutricional: ficha
      };

      await guardarConfiguracion(nuevaConfig, userEmail);
      onConfigActualizada(nuevaConfig);
      setMensajeExito('Configuración general guardada y sincronizada en Firestore exitosamente.');
      setTimeout(() => setMensajeExito(null), 4000);
    } catch (err: any) {
      console.error('Error guardando configuración:', err);
      setErrorMsg(err.message || 'Error al guardar configuración en Firestore.');
    } finally {
      setGuardando(false);
    }
  };

  // Manejo de permisos por parte de Carlos
  const handleCambioCargo = (uid: string, nuevoCargo: string) => {
    setEdicionUsuarios((prev) => ({
      ...prev,
      [uid]: {
        ...prev[uid],
        cargo: nuevoCargo
      }
    }));
  };

  const handleCambioEstado = (uid: string, nuevoEstado: 'activo' | 'pendiente' | 'inactivo') => {
    setEdicionUsuarios((prev) => ({
      ...prev,
      [uid]: {
        ...prev[uid],
        estado: nuevoEstado
      }
    }));
  };

  const handleTogglePermiso = (uid: string, permiso: keyof PermisosUsuario) => {
    setEdicionUsuarios((prev) => {
      const actual = prev[uid]?.permisos || {
        crearLotes: false,
        registrarEventos: false,
        cerrarLotes: false,
        gestionarEstanques: false,
        gestionarConfiguracion: false,
        administrarUsuarios: false
      };
      return {
        ...prev,
        [uid]: {
          ...prev[uid],
          permisos: {
            ...actual,
            [permiso]: !actual[permiso]
          }
        }
      };
    });
  };

  const handleGuardarUsuario = async (u: UsuarioPerfil) => {
    const edit = edicionUsuarios[u.uid];
    if (!edit) return;

    setGuardandoUsuarioId(u.uid);
    setMensajeUsuarioExito(null);

    try {
      await actualizarPerfilOperario(u.uid, edit, userEmail);
      setMensajeUsuarioExito(`Permisos y cargo de "${u.email}" actualizados correctamente.`);
      setTimeout(() => setMensajeUsuarioExito(null), 4000);
    } catch (err: any) {
      alert(`Error al actualizar operario: ${err.message || err}`);
    } finally {
      setGuardandoUsuarioId(null);
    }
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Cabecera Principal */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center space-x-2">
            <Settings className="w-5 h-5 text-sky-600" />
            <span>Configuración y Control de Permisos</span>
          </h1>
          <p className="text-xs text-slate-500">
            Administración de estanques, umbrales de agua, ficha nutricional y control de operarios
          </p>
        </div>

        <button
          onClick={handleGuardarTodo}
          disabled={guardando}
          className="inline-flex items-center space-x-2 px-5 py-2.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-bold shadow-xs transition-colors disabled:opacity-50 shrink-0"
        >
          {guardando ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Guardando en Firestore...</span>
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              <span>Guardar Configuración General</span>
            </>
          )}
        </button>
      </div>

      {mensajeExito && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center space-x-2 text-emerald-800 text-xs">
          <CheckCircle className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{mensajeExito}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center space-x-2 text-red-700 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* SECCIÓN PRINCIPAL: CONTROL DE ACCESO Y AUTORIZACIÓN DE OPERARIOS (SOLO CARLOS) */}
      <div className="bg-white rounded-xl border-2 border-sky-600/30 shadow-md p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
          <div>
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-5 h-5 text-sky-600" />
              <h2 className="text-base font-bold text-slate-900">
                Control de Operarios y Asignación de Permisos
              </h2>
            </div>
            <p className="text-xs text-slate-600 mt-1">
              {esAdmin
                ? 'Administrador Maestro: carlosbs1579@gmail.com. Solo tú puedes autorizar operarios, nombrar su posición y decidir qué acciones pueden realizar.'
                : 'Zona de consulta de perfil. Solo el administrador maestro (carlosbs1579@gmail.com) puede conceder o modificar permisos.'}
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-xs bg-sky-100 text-sky-800 font-bold px-3 py-1 rounded-full border border-sky-300 flex items-center space-x-1">
              <Shield className="w-3.5 h-3.5 mr-1" />
              {esAdmin ? 'Modo Administrador Maestro' : 'Perfil Operario'}
            </span>
          </div>
        </div>

        {mensajeUsuarioExito && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center space-x-2 text-emerald-800 text-xs">
            <Check className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{mensajeUsuarioExito}</span>
          </div>
        )}

        {esAdmin ? (
          /* VISTA ADMINISTRADOR (CARLOS) */
          <div className="space-y-6">
            <div className="text-xs text-slate-500">
              Usa la <strong>barra de escritura</strong> de cada perfil para asignarle un nombre a su posición o cargo laboral, y marca individualmente las casillas según lo que tenga permitido hacer en la web.
            </div>

            {usuariosCargando ? (
              <div className="py-8 flex items-center justify-center space-x-2 text-xs text-slate-500">
                <div className="w-5 h-5 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
                <span>Cargando perfiles registrados en Firestore...</span>
              </div>
            ) : usuarios.length === 0 ? (
              <div className="p-6 bg-slate-50 rounded-lg text-center text-xs text-slate-500">
                Aún no hay otros operarios registrados. Cuando ingresen con correo y contraseña o Google, aparecerán aquí automáticamente para que los autorices.
              </div>
            ) : (
              <div className="space-y-4">
                {usuarios.map((u) => {
                  const esElAdmin = esAdminMaestro(u.email);
                  const ed = edicionUsuarios[u.uid] || {
                    cargo: u.cargo,
                    estado: u.estado,
                    permisos: u.permisos
                  };

                  return (
                    <div
                      key={u.uid}
                      className={`p-4 rounded-xl border transition-all ${
                        esElAdmin
                          ? 'bg-sky-50/60 border-sky-300'
                          : ed.estado === 'activo'
                          ? 'bg-white border-slate-200 hover:border-slate-300'
                          : 'bg-amber-50/40 border-amber-200'
                      }`}
                    >
                      {/* Cabecera del Usuario */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                        <div className="flex items-center space-x-3">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs ${
                            esElAdmin ? 'bg-sky-600 text-white' : 'bg-slate-200 text-slate-700'
                          }`}>
                            <UserIcon className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="font-bold text-sm text-slate-900">{u.displayName || u.email}</span>
                              <span className="text-xs text-slate-500 font-mono">({u.email})</span>
                              {esElAdmin && (
                                <span className="text-[10px] bg-sky-200 text-sky-900 font-bold px-2 py-0.5 rounded-full">
                                  PROPIETARIO / ADMIN
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-400">
                              UID: {u.uid.substring(0, 14)}... • Registrado: {u.creadoEn?.substring(0, 10)}
                            </p>
                          </div>
                        </div>

                        {/* Selector de Estado */}
                        {!esElAdmin ? (
                          <div className="flex items-center space-x-2">
                            <label className="text-xs font-semibold text-slate-700">Estado:</label>
                            <select
                              value={ed.estado}
                              onChange={(e) => handleCambioEstado(u.uid, e.target.value as any)}
                              className={`px-3 py-1 text-xs font-bold rounded-lg border focus:outline-none ${
                                ed.estado === 'activo'
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                  : ed.estado === 'pendiente'
                                  ? 'bg-amber-50 text-amber-800 border-amber-300'
                                  : 'bg-slate-100 text-slate-600 border-slate-300'
                              }`}
                            >
                              <option value="activo">🟢 Activo (Autorizado)</option>
                              <option value="pendiente">🟡 Pendiente de Aprobación</option>
                              <option value="inactivo">🔴 Inactivo (Sin Acceso)</option>
                            </select>
                          </div>
                        ) : (
                          <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-3 py-1 rounded-full">
                            🟢 Siempre Activo
                          </span>
                        )}
                      </div>

                      {/* Barra de escritura para la POSICIÓN / CARGO */}
                      <div className="mb-4">
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          Posición / Cargo de este operario:
                        </label>
                        <div className="flex items-center space-x-2">
                          <input
                            type="text"
                            disabled={esElAdmin}
                            placeholder="Escribe el nombre de su posición (ej: Biólogo Jefe, Técnico de Siembra, Operario de Cosecha...)"
                            value={ed.cargo}
                            onChange={(e) => handleCambioCargo(u.uid, e.target.value)}
                            className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white font-medium"
                          />
                        </div>
                      </div>

                      {/* Matriz de Permisos (Checkboxes) */}
                      <div className="pt-3 border-t border-slate-100">
                        <p className="text-xs font-bold text-slate-700 mb-2">
                          ¿Qué puede hacer este operario en la web?
                        </p>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                          {/* 1. Añadir nuevos lotes */}
                          <label className={`flex items-start space-x-2 p-2 rounded-lg border text-xs cursor-pointer ${
                            ed.permisos.crearLotes ? 'bg-sky-50 border-sky-200 text-sky-900 font-semibold' : 'bg-slate-50 border-slate-200 text-slate-600'
                          }`}>
                            <input
                              type="checkbox"
                              disabled={esElAdmin}
                              checked={ed.permisos.crearLotes}
                              onChange={() => handleTogglePermiso(u.uid, 'crearLotes')}
                              className="mt-0.5 rounded text-sky-600 focus:ring-sky-500"
                            />
                            <div>
                              <span>Añadir nuevos lotes</span>
                              <p className="text-[10px] text-slate-400 font-normal">Crear lote y registrar siembra</p>
                            </div>
                          </label>

                          {/* 2. Cargar y registrar eventos */}
                          <label className={`flex items-start space-x-2 p-2 rounded-lg border text-xs cursor-pointer ${
                            ed.permisos.registrarEventos ? 'bg-sky-50 border-sky-200 text-sky-900 font-semibold' : 'bg-slate-50 border-slate-200 text-slate-600'
                          }`}>
                            <input
                              type="checkbox"
                              disabled={esElAdmin}
                              checked={ed.permisos.registrarEventos}
                              onChange={() => handleTogglePermiso(u.uid, 'registrarEventos')}
                              className="mt-0.5 rounded text-sky-600 focus:ring-sky-500"
                            />
                            <div>
                              <span>Cargar / Registrar eventos</span>
                              <p className="text-[10px] text-slate-400 font-normal">Alimentación, agua, muestreos...</p>
                            </div>
                          </label>

                          {/* 3. Cerrar lotes */}
                          <label className={`flex items-start space-x-2 p-2 rounded-lg border text-xs cursor-pointer ${
                            ed.permisos.cerrarLotes ? 'bg-sky-50 border-sky-200 text-sky-900 font-semibold' : 'bg-slate-50 border-slate-200 text-slate-600'
                          }`}>
                            <input
                              type="checkbox"
                              disabled={esElAdmin}
                              checked={ed.permisos.cerrarLotes}
                              onChange={() => handleTogglePermiso(u.uid, 'cerrarLotes')}
                              className="mt-0.5 rounded text-sky-600 focus:ring-sky-500"
                            />
                            <div>
                              <span>Cerrar lotes y generar PDF</span>
                              <p className="text-[10px] text-slate-400 font-normal">Finalizar ciclo y subir a Storage</p>
                            </div>
                          </label>

                          {/* 4. Crear otras piscinas / estanques */}
                          <label className={`flex items-start space-x-2 p-2 rounded-lg border text-xs cursor-pointer ${
                            ed.permisos.gestionarEstanques ? 'bg-sky-50 border-sky-200 text-sky-900 font-semibold' : 'bg-slate-50 border-slate-200 text-slate-600'
                          }`}>
                            <input
                              type="checkbox"
                              disabled={esElAdmin}
                              checked={ed.permisos.gestionarEstanques}
                              onChange={() => handleTogglePermiso(u.uid, 'gestionarEstanques')}
                              className="mt-0.5 rounded text-sky-600 focus:ring-sky-500"
                            />
                            <div>
                              <span>Crear otras piscinas / estanques</span>
                              <p className="text-[10px] text-slate-400 font-normal">Agregar E3, E4 y volúmenes</p>
                            </div>
                          </label>

                          {/* 5. Modificar configuración general */}
                          <label className={`flex items-start space-x-2 p-2 rounded-lg border text-xs cursor-pointer ${
                            ed.permisos.gestionarConfiguracion ? 'bg-sky-50 border-sky-200 text-sky-900 font-semibold' : 'bg-slate-50 border-slate-200 text-slate-600'
                          }`}>
                            <input
                              type="checkbox"
                              disabled={esElAdmin}
                              checked={ed.permisos.gestionarConfiguracion}
                              onChange={() => handleTogglePermiso(u.uid, 'gestionarConfiguracion')}
                              className="mt-0.5 rounded text-sky-600 focus:ring-sky-500"
                            />
                            <div>
                              <span>Modificar rangos y nutrición</span>
                              <p className="text-[10px] text-slate-400 font-normal">Límites fisicoquímicos y ficha</p>
                            </div>
                          </label>

                          {/* 6. Administrar usuarios */}
                          <label className={`flex items-start space-x-2 p-2 rounded-lg border text-xs cursor-pointer ${
                            ed.permisos.administrarUsuarios ? 'bg-sky-50 border-sky-200 text-sky-900 font-semibold' : 'bg-slate-50 border-slate-200 text-slate-600'
                          }`}>
                            <input
                              type="checkbox"
                              disabled={esElAdmin}
                              checked={ed.permisos.administrarUsuarios}
                              onChange={() => handleTogglePermiso(u.uid, 'administrarUsuarios')}
                              className="mt-0.5 rounded text-sky-600 focus:ring-sky-500"
                            />
                            <div>
                              <span>Administrar permisos</span>
                              <p className="text-[10px] text-slate-400 font-normal">Autorizar a otros operarios</p>
                            </div>
                          </label>
                        </div>
                      </div>

                      {/* Botón de Guardar Operario */}
                      {!esElAdmin && (
                        <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
                          <button
                            type="button"
                            onClick={() => handleGuardarUsuario(u)}
                            disabled={guardandoUsuarioId === u.uid}
                            className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold inline-flex items-center space-x-1.5 transition-colors disabled:opacity-50"
                          >
                            {guardandoUsuarioId === u.uid ? (
                              <>
                                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                <span>Guardando...</span>
                              </>
                            ) : (
                              <>
                                <Save className="w-3.5 h-3.5" />
                                <span>Guardar Posición y Permisos de {u.displayName || u.email.split('@')[0]}</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* VISTA OPERARIO REGULAR: SOLO CONSULTA DE SU PROPIA CUENTA */
          <div className="space-y-4">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Estado de tu Perfil Operativo</h3>
                  <p className="text-xs text-slate-500">{userEmail}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${
                  perfilActual?.estado === 'activo'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }`}>
                  {perfilActual?.estado === 'activo' ? '🟢 Cuenta Autorizada' : '🟡 Pendiente de Aprobación'}
                </span>
              </div>

              <div>
                <span className="text-xs text-slate-500 font-medium">Posición asignada por Carlos:</span>
                <p className="text-sm font-bold text-slate-900">
                  {perfilActual?.cargo || 'Operario en espera de asignación'}
                </p>
              </div>

              <div className="pt-2 border-t border-slate-200/60">
                <p className="text-xs font-semibold text-slate-700 mb-2">Tus permisos asignados:</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  <div className={`p-2 rounded border ${perfilActual?.permisos?.crearLotes ? 'bg-emerald-50 text-emerald-800 border-emerald-200 font-medium' : 'bg-slate-100 text-slate-400 border-slate-200'}`}>
                    {perfilActual?.permisos?.crearLotes ? '✓' : '✗'} Añadir nuevos lotes
                  </div>
                  <div className={`p-2 rounded border ${perfilActual?.permisos?.registrarEventos ? 'bg-emerald-50 text-emerald-800 border-emerald-200 font-medium' : 'bg-slate-100 text-slate-400 border-slate-200'}`}>
                    {perfilActual?.permisos?.registrarEventos ? '✓' : '✗'} Cargar / Registrar eventos
                  </div>
                  <div className={`p-2 rounded border ${perfilActual?.permisos?.cerrarLotes ? 'bg-emerald-50 text-emerald-800 border-emerald-200 font-medium' : 'bg-slate-100 text-slate-400 border-slate-200'}`}>
                    {perfilActual?.permisos?.cerrarLotes ? '✓' : '✗'} Cerrar lotes y PDF
                  </div>
                  <div className={`p-2 rounded border ${perfilActual?.permisos?.gestionarEstanques ? 'bg-emerald-50 text-emerald-800 border-emerald-200 font-medium' : 'bg-slate-100 text-slate-400 border-slate-200'}`}>
                    {perfilActual?.permisos?.gestionarEstanques ? '✓' : '✗'} Crear piscinas / estanques
                  </div>
                  <div className={`p-2 rounded border ${perfilActual?.permisos?.gestionarConfiguracion ? 'bg-emerald-50 text-emerald-800 border-emerald-200 font-medium' : 'bg-slate-100 text-slate-400 border-slate-200'}`}>
                    {perfilActual?.permisos?.gestionarConfiguracion ? '✓' : '✗'} Modificar configuración
                  </div>
                </div>
              </div>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start space-x-2 text-amber-900 text-xs">
              <Lock className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <span>
                Para solicitar nuevos permisos o actualización de tu cargo laboral, contacta al administrador maestro Carlos en <strong>{ADMIN_MASTER_EMAIL}</strong>.
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 1. ESTANQUES DE CULTIVO (SOLO CON PERMISO gestionarEstanques) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
            <span>1. Estanques de Cultivo</span>
          </h2>
          <p className="text-xs text-slate-500">
            Agrega o modifica estanques para permitir la creación de nuevos lotes sin alterar código.
          </p>
        </div>

        {/* Lista de estanques existentes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {estanques.map((est) => (
            <div
              key={est.codigo}
              className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between"
            >
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-mono font-bold text-sm bg-sky-100 text-sky-800 px-2 py-0.5 rounded">
                    {est.codigo}
                  </span>
                  <span className="text-xs font-semibold text-slate-800">{est.nombre}</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Volumen: {est.volumenM3 ? `${est.volumenM3} m³` : 'Sin especificar'}
                </p>
              </div>

              {(esAdmin || perfilActual?.permisos?.gestionarEstanques) && (
                <button
                  type="button"
                  onClick={() => handleEliminarEstanque(est.codigo)}
                  className="text-slate-400 hover:text-red-500 p-1 transition-colors"
                  title="Eliminar estanque"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Formulario para agregar estanque (Solo si tiene permiso) */}
        {(esAdmin || perfilActual?.permisos?.gestionarEstanques) ? (
          <form onSubmit={handleAgregarEstanque} className="pt-3 border-t border-slate-100 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Código (ej: E3) *
              </label>
              <input
                type="text"
                required
                placeholder="E3"
                value={nuevoCodigo}
                onChange={(e) => setNuevoCodigo(e.target.value)}
                className="w-24 px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg uppercase"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Nombre descriptivo
              </label>
              <input
                type="text"
                placeholder="Estanque 3 (Circular)"
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value)}
                className="w-48 px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Volumen (m³)
              </label>
              <input
                type="number"
                placeholder="250"
                value={nuevoVolumen}
                onChange={(e) => setNuevoVolumen(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-28 px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
            </div>

            <button
              type="submit"
              className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold inline-flex items-center space-x-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Agregar Estanque</span>
            </button>
          </form>
        ) : (
          <p className="text-xs text-slate-400 italic">
            Crear nuevas piscinas requiere permiso otorgado por Carlos.
          </p>
        )}
      </div>

      {/* 2. RANGOS DE REFERENCIA DE CALIDAD DEL AGUA */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
            <Droplets className="w-4 h-4 text-sky-600" />
            <span>2. Rangos de Referencia para Calidad del Agua</span>
          </h2>
          <p className="text-xs text-slate-500">
            Valores estándar para la cuenca de Turbaco (Bolívar). Mediciones fuera de estos rangos disparan alertas automáticas.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Temperatura */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <span className="text-xs font-bold text-slate-800 block">Temperatura (°C)</span>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-500">Mínimo</label>
                <input
                  type="number"
                  step="0.5"
                  disabled={!esAdmin && !perfilActual?.permisos?.gestionarConfiguracion}
                  value={rangos.temperaturaMin}
                  onChange={(e) => setRangos({ ...rangos, temperaturaMin: Number(e.target.value) })}
                  className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500">Máximo</label>
                <input
                  type="number"
                  step="0.5"
                  disabled={!esAdmin && !perfilActual?.permisos?.gestionarConfiguracion}
                  value={rangos.temperaturaMax}
                  onChange={(e) => setRangos({ ...rangos, temperaturaMax: Number(e.target.value) })}
                  className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
                />
              </div>
            </div>
          </div>

          {/* Oxígeno Disuelto */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <span className="text-xs font-bold text-slate-800 block">Oxígeno Disuelto (mg/L)</span>
            <div>
              <label className="text-[10px] text-slate-500">Mínimo Crítico</label>
              <input
                type="number"
                step="0.1"
                disabled={!esAdmin && !perfilActual?.permisos?.gestionarConfiguracion}
                value={rangos.oxigenoMin}
                onChange={(e) => setRangos({ ...rangos, oxigenoMin: Number(e.target.value) })}
                className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
              />
            </div>
          </div>

          {/* pH */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <span className="text-xs font-bold text-slate-800 block">pH</span>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-500">Mínimo</label>
                <input
                  type="number"
                  step="0.1"
                  disabled={!esAdmin && !perfilActual?.permisos?.gestionarConfiguracion}
                  value={rangos.phMin}
                  onChange={(e) => setRangos({ ...rangos, phMin: Number(e.target.value) })}
                  className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500">Máximo</label>
                <input
                  type="number"
                  step="0.1"
                  disabled={!esAdmin && !perfilActual?.permisos?.gestionarConfiguracion}
                  value={rangos.phMax}
                  onChange={(e) => setRangos({ ...rangos, phMax: Number(e.target.value) })}
                  className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
                />
              </div>
            </div>
          </div>

          {/* Amonio total */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <span className="text-xs font-bold text-slate-800 block">Amonio Total (mg/L)</span>
            <div>
              <label className="text-[10px] text-slate-500">Máximo Permitido</label>
              <input
                type="number"
                step="0.1"
                disabled={!esAdmin && !perfilActual?.permisos?.gestionarConfiguracion}
                value={rangos.amonioMax}
                onChange={(e) => setRangos({ ...rangos, amonioMax: Number(e.target.value) })}
                className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
              />
            </div>
          </div>

          {/* Nitritos */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <span className="text-xs font-bold text-slate-800 block">Nitritos (mg/L)</span>
            <div>
              <label className="text-[10px] text-slate-500">Máximo Permitido (Tóxico)</label>
              <input
                type="number"
                step="0.01"
                disabled={!esAdmin && !perfilActual?.permisos?.gestionarConfiguracion}
                value={rangos.nitritosMax}
                onChange={(e) => setRangos({ ...rangos, nitritosMax: Number(e.target.value) })}
                className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
              />
            </div>
          </div>

          {/* Transparencia Secchi */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <span className="text-xs font-bold text-slate-800 block">Transparencia Secchi (cm)</span>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-500">Mínimo</label>
                <input
                  type="number"
                  step="1"
                  disabled={!esAdmin && !perfilActual?.permisos?.gestionarConfiguracion}
                  value={rangos.secchiMin}
                  onChange={(e) => setRangos({ ...rangos, secchiMin: Number(e.target.value) })}
                  className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500">Máximo</label>
                <input
                  type="number"
                  step="1"
                  disabled={!esAdmin && !perfilActual?.permisos?.gestionarConfiguracion}
                  value={rangos.secchiMax}
                  onChange={(e) => setRangos({ ...rangos, secchiMax: Number(e.target.value) })}
                  className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. FICHA NUTRICIONAL REFERENCIAL */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
            <Apple className="w-4 h-4 text-emerald-600" />
            <span>3. Ficha Nutricional (por 100 g de tilapia cruda)</span>
          </h2>
          <p className="text-xs text-slate-500">
            Aparece impresa en el certificado PDF de cada lote como información para el consumidor y restaurantes.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-700 mb-1">Energía (kcal)</label>
            <input
              type="number"
              disabled={!esAdmin && !perfilActual?.permisos?.gestionarConfiguracion}
              value={ficha.energiaKcal}
              onChange={(e) => setFicha({ ...ficha, energiaKcal: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-700 mb-1">Proteína (g)</label>
            <input
              type="number"
              step="0.1"
              disabled={!esAdmin && !perfilActual?.permisos?.gestionarConfiguracion}
              value={ficha.proteinaG}
              onChange={(e) => setFicha({ ...ficha, proteinaG: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-700 mb-1">Grasa total (g)</label>
            <input
              type="number"
              step="0.1"
              disabled={!esAdmin && !perfilActual?.permisos?.gestionarConfiguracion}
              value={ficha.grasaTotalG}
              onChange={(e) => setFicha({ ...ficha, grasaTotalG: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-700 mb-1">Carbohidratos (g)</label>
            <input
              type="number"
              step="0.1"
              disabled={!esAdmin && !perfilActual?.permisos?.gestionarConfiguracion}
              value={ficha.carbohidratosG}
              onChange={(e) => setFicha({ ...ficha, carbohidratosG: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-700 mb-1">Colesterol (mg)</label>
            <input
              type="number"
              disabled={!esAdmin && !perfilActual?.permisos?.gestionarConfiguracion}
              value={ficha.colesterolMg}
              onChange={(e) => setFicha({ ...ficha, colesterolMg: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-700 mb-1">Sodio (mg)</label>
            <input
              type="number"
              disabled={!esAdmin && !perfilActual?.permisos?.gestionarConfiguracion}
              value={ficha.sodioMg}
              onChange={(e) => setFicha({ ...ficha, sodioMg: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <div>
            <label className="block text-[11px] font-medium text-slate-700 mb-1">Fuente Referencial</label>
            <input
              type="text"
              disabled={!esAdmin && !perfilActual?.permisos?.gestionarConfiguracion}
              value={ficha.fuente}
              onChange={(e) => setFicha({ ...ficha, fuente: e.target.value })}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-700 mb-1">Notas al pie</label>
            <input
              type="text"
              disabled={!esAdmin && !perfilActual?.permisos?.gestionarConfiguracion}
              value={ficha.notas}
              onChange={(e) => setFicha({ ...ficha, notas: e.target.value })}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
