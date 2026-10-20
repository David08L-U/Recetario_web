// Referencias al DOM
const form = document.getElementById('form-busqueda');
const input = document.getElementById('input-busqueda');
const logo = document.getElementById('logo');
const chips = document.querySelectorAll('.chip');
const botonesIdioma = document.querySelectorAll('.idioma button');
const bannerOffline = document.getElementById('banner-offline');

const vistaInicio = document.getElementById('inicio');
const recetaDelDia = document.getElementById('receta-del-dia');
const destacadas = document.getElementById('destacadas');

const vistaResultados = document.getElementById('vista-resultados');
const tituloResultados = document.getElementById('titulo-resultados');
const btnVolver = document.getElementById('btn-volver');
const resultados = document.getElementById('resultados');
const mensaje = document.getElementById('mensaje');
const contador = document.getElementById('contador');
const btnVerMas = document.getElementById('btn-ver-mas');

const modal = document.getElementById('modal');
const detalle = document.getElementById('detalle');
const cerrarModal = document.getElementById('cerrar-modal');
const toast = document.getElementById('toast');

// El navegador llama a NUESTRO servidor, nunca directo a la API externa.
// Así la API Key nunca llega al frontend.

// ---------------------------------------------------------------
// Estado de la app
// ---------------------------------------------------------------
let idioma = leerIdioma();           // 'es' o 'en'
let recetaAbierta = null;            // id de la receta en el modal
let accionPendiente = null;          // qué reintentar cuando vuelva internet
let controladorBusqueda = null;      // para cancelar búsquedas viejas
const busqueda = {                   // búsqueda actual (para "Ver más")
  params: null,
  titulo: '',
  offset: 0,
  total: 0,
  cargando: false
};

const TIEMPO_MAX = 30000; // 30 s (traducir puede tardar)

// Imagen de respaldo si la de Spoonacular falla o no existe
const IMAGEN_RESPALDO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">' +
  '<rect width="400" height="300" fill="#ffe8d6"/>' +
  '<text x="200" y="175" font-size="90" text-anchor="middle">🍽️</text></svg>'
);

// Evita que texto de la API se interprete como HTML
function escapar(texto = '') {
  return String(texto).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ===============================================================
// MANEJO DE ERRORES
// ===============================================================
class ErrorApp extends Error {
  constructor(mensaje, codigo = 'DESCONOCIDO', status = 0) {
    super(mensaje);
    this.codigo = codigo;
    this.status = status;
  }
}

// Icono, sugerencia y si tiene sentido reintentar, según el tipo de error
const INFO_ERRORES = {
  SIN_INTERNET:          { icono: '📡', sugerencia: 'Revisa tu Wi-Fi o datos móviles.', reintentar: true },
  SERVIDOR_CAIDO:        { icono: '🔌', sugerencia: 'Verifica que el servidor esté corriendo (npm run dev).', reintentar: true },
  TIEMPO_AGOTADO:        { icono: '⏳', sugerencia: 'La conexión está lenta. Intenta de nuevo.', reintentar: true },
  SIN_CONEXION_API:      { icono: '🌐', sugerencia: 'El servidor no tiene acceso a internet.', reintentar: true },
  ERROR_EXTERNO:         { icono: '🛠️', sugerencia: 'El servicio de recetas falló. Intenta en un momento.', reintentar: true },
  LIMITE_DIARIO:         { icono: '🚫', sugerencia: 'El límite gratis se reinicia cada día.', reintentar: false },
  DEMASIADAS_PETICIONES: { icono: '🐢', sugerencia: 'Espera unos segundos antes de intentar otra vez.', reintentar: true },
  NO_ENCONTRADO:         { icono: '🔍', sugerencia: 'Puede que la receta ya no exista.', reintentar: false },
  RUTA_NO_EXISTE:        { icono: '🔍', sugerencia: '', reintentar: false },
  API_KEY:               { icono: '🔑', sugerencia: 'Revisa SPOONACULAR_API_KEY en .env y reinicia el servidor.', reintentar: false },
  PARAMETRO_INVALIDO:    { icono: '✏️', sugerencia: 'Revisa lo que escribiste.', reintentar: false },
  RESPUESTA_VACIA:       { icono: '📭', sugerencia: 'Intenta de nuevo en un momento.', reintentar: true },
  DESCONOCIDO:           { icono: '⚠️', sugerencia: '', reintentar: true }
};

// Mensaje genérico si el servidor no mandó uno
function mensajePorStatus(status) {
  if (status === 404) return 'No se encontró lo que buscabas.';
  if (status === 429) return 'Demasiadas peticiones. Espera un momento.';
  if (status >= 500) return 'El servidor tuvo un problema.';
  return `Error inesperado (${status}).`;
}

function codigoPorStatus(status) {
  if (status === 404) return 'NO_ENCONTRADO';
  if (status === 429) return 'DEMASIADAS_PETICIONES';
  return 'DESCONOCIDO';
}

// Pide JSON a nuestro servidor con: idioma, tiempo límite,
// detección de "sin internet" y errores convertidos a ErrorApp
async function pedir(ruta, params = {}, { signal } = {}) {
  if (!navigator.onLine) {
    throw new ErrorApp('No tienes conexión a internet.', 'SIN_INTERNET');
  }

  const url = ruta + '?' + new URLSearchParams({ ...params, lang: idioma });
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort('tiempo'), TIEMPO_MAX);
  signal?.addEventListener('abort', () => controlador.abort('cancelado'));

  let res;
  try {
    res = await fetch(url, { signal: controlador.signal });
  } catch {
    clearTimeout(temporizador);
    if (controlador.signal.aborted) {
      if (controlador.signal.reason === 'cancelado') throw new ErrorApp('Cancelado', 'CANCELADO');
      throw new ErrorApp('El servidor tardó demasiado en responder.', 'TIEMPO_AGOTADO');
    }
    if (!navigator.onLine) throw new ErrorApp('No tienes conexión a internet.', 'SIN_INTERNET');
    throw new ErrorApp('No se pudo conectar con el servidor.', 'SERVIDOR_CAIDO');
  }
  clearTimeout(temporizador);

  // Leer como texto primero por si la respuesta viene vacía o no es JSON
  let datos = null;
  try {
    const texto = await res.text();
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    datos = null;
  }

  if (!res.ok) {
    throw new ErrorApp(
      datos?.error || mensajePorStatus(res.status),
      datos?.codigo || codigoPorStatus(res.status),
      res.status
    );
  }
  if (!datos || typeof datos !== 'object') {
    throw new ErrorApp('El servidor respondió vacío o con datos inválidos.', 'RESPUESTA_VACIA');
  }

  mostrarAviso(datos.aviso);
  return datos;
}

// Pinta un error dentro de un contenedor, con botón "Reintentar" si aplica
function pintarError(contenedor, err, reintentar) {
  const info = INFO_ERRORES[err.codigo] || INFO_ERRORES.DESCONOCIDO;
  const caja = document.createElement('div');
  caja.className = 'estado-error';
  caja.innerHTML = `
    <span class="icono">${info.icono}</span>
    <p><strong>${escapar(err.message || 'Ocurrió un error')}</strong></p>
    ${info.sugerencia ? `<p class="sugerencia">${escapar(info.sugerencia)}</p>` : ''}
  `;
  if (info.reintentar && reintentar) {
    const boton = document.createElement('button');
    boton.className = 'btn-secundario';
    boton.textContent = '🔄 Reintentar';
    boton.addEventListener('click', reintentar);
    caja.appendChild(boton);
    // Si el problema fue la conexión, reintentar solo cuando vuelva
    if (['SIN_INTERNET', 'SERVIDOR_CAIDO', 'TIEMPO_AGOTADO'].includes(err.codigo)) {
      accionPendiente = reintentar;
    }
  }
  contenedor.innerHTML = '';
  contenedor.appendChild(caja);
}

// Estado vacío (no es error, solo no hay datos)
function pintarVacio(contenedor, icono, texto, sugerencia = '') {
  contenedor.innerHTML = `
    <div class="estado-error">
      <span class="icono">${icono}</span>
      <p><strong>${escapar(texto)}</strong></p>
      ${sugerencia ? `<p class="sugerencia">${escapar(sugerencia)}</p>` : ''}
    </div>
  `;
}

// Cambia imágenes rotas por la imagen de respaldo
function protegerImagenes(contenedor) {
  contenedor.querySelectorAll('img').forEach((img) => {
    if (!img.getAttribute('src')) img.src = IMAGEN_RESPALDO;
    img.addEventListener('error', () => {
      if (img.src !== IMAGEN_RESPALDO) {
        img.src = IMAGEN_RESPALDO;
        img.classList.add('img-respaldo');
      }
    }, { once: true });
  });
}

// Aviso flotante que desaparece solo
let temporizadorToast;
function mostrarAviso(texto) {
  if (!texto) return;
  toast.textContent = texto;
  toast.classList.add('visible');
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => toast.classList.remove('visible'), 5000);
}

// ---------------------------------------------------------------
// NUEVO: detectar cuando se va / vuelve el internet
// ---------------------------------------------------------------
function actualizarConexion() {
  bannerOffline.hidden = navigator.onLine;
}

window.addEventListener('offline', actualizarConexion);
window.addEventListener('online', () => {
  actualizarConexion();
  mostrarAviso('✅ Conexión restablecida');
  if (accionPendiente) {
    const accion = accionPendiente;
    accionPendiente = null;
    accion();
  }
});

// Errores de JS que nadie atrapó: avisar en lugar de fallar en silencio
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  if (e.reason?.codigo !== 'CANCELADO') mostrarAviso('Ocurrió un error inesperado.');
});

// ---------------------------------------------------------------
// Idioma (ES / EN), se recuerda en el navegador
// ---------------------------------------------------------------
function leerIdioma() {
  try { return localStorage.getItem('idioma') || 'es'; } catch { return 'es'; }
}

function marcarIdioma() {
  botonesIdioma.forEach((b) => b.classList.toggle('activo', b.dataset.idioma === idioma));
}

botonesIdioma.forEach((boton) => {
  boton.addEventListener('click', () => {
    if (boton.dataset.idioma === idioma) return;
    idioma = boton.dataset.idioma;
    try { localStorage.setItem('idioma', idioma); } catch {}
    marcarIdioma();

    if (!vistaResultados.hidden && busqueda.params) buscar(busqueda.params, busqueda.titulo);
    else cargarInicio();
    if (modal.open && recetaAbierta) verDetalle(recetaAbierta);
  });
});

// ---------------------------------------------------------------
// Cambiar entre pantalla principal y resultados
// ---------------------------------------------------------------
function mostrarInicio() {
  controladorBusqueda?.abort();
  vistaResultados.hidden = true;
  vistaInicio.hidden = false;
  input.value = '';
  marcarChip(null);
}

function mostrarVistaResultados(titulo) {
  vistaInicio.hidden = true;
  vistaResultados.hidden = false;
  tituloResultados.textContent = titulo;
}

function marcarChip(categoria) {
  chips.forEach((c) => c.classList.toggle('activa', c.dataset.categoria === categoria));
}

logo.addEventListener('click', (e) => { e.preventDefault(); mostrarInicio(); });
btnVolver.addEventListener('click', mostrarInicio);

// ---------------------------------------------------------------
// Pantalla principal (receta del día + destacadas)
// ---------------------------------------------------------------
async function cargarInicio() {
  recetaDelDia.innerHTML = `<p class="cargando">${idioma === 'es' ? 'Cargando y traduciendo...' : 'Cargando...'}</p>`;
  destacadas.innerHTML = '';
  try {
    const datos = await pedir('/api/inicio');

    if (datos.delDia?.id) pintarRecetaDelDia(datos.delDia);
    else pintarVacio(recetaDelDia, '📭', 'Hoy no hay receta del día.');

    const lista = Array.isArray(datos.destacadas) ? datos.destacadas : [];
    if (lista.length === 0) {
      pintarVacio(destacadas, '📭', 'No hay recetas destacadas por ahora.');
    } else {
      lista.forEach((r) => destacadas.appendChild(crearTarjeta(r)));
    }
  } catch (err) {
    pintarError(recetaDelDia, err, cargarInicio);
  }
}

function pintarRecetaDelDia(r) {
  recetaDelDia.innerHTML = `
    <img src="${escapar(r.imagen)}" alt="${escapar(r.titulo)}">
    <div class="hero-info">
      <span class="etiqueta">⭐ Receta del día</span>
      <h2>${escapar(r.titulo)}</h2>
      ${r.resumen ? `<p class="resumen">${escapar(r.resumen)}</p>` : ''}
      <p class="meta">⏱ ${escapar(r.minutos)} min · 🍽 ${escapar(r.porciones)} porciones · ❤️ ${escapar(r.likes)}</p>
      <button class="btn-primario" id="btn-ver-dia">Ver receta</button>
    </div>
  `;
  protegerImagenes(recetaDelDia);
  document.getElementById('btn-ver-dia').addEventListener('click', () => verDetalle(r.id));
}

// ---------------------------------------------------------------
// Búsqueda por texto y por categoría
// ---------------------------------------------------------------
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) {
    mostrarAviso('Escribe algo para buscar 🙂');
    input.focus();
    return;
  }
  if (q.length > 100) {
    mostrarAviso('La búsqueda es demasiado larga (máx. 100 caracteres).');
    return;
  }
  marcarChip(null);
  buscar({ q }, `Resultados para "${q}"`);
});

chips.forEach((chip) => {
  chip.addEventListener('click', () => {
    const categoria = chip.dataset.categoria;
    input.value = '';
    marcarChip(categoria);
    buscar({ categoria }, chip.textContent.trim());
  });
});

// Búsqueda nueva: cancela la anterior, limpia y carga la primera página
async function buscar(params, titulo) {
  controladorBusqueda?.abort();
  controladorBusqueda = new AbortController();

  Object.assign(busqueda, { params, titulo, offset: 0, total: 0, cargando: false });
  mostrarVistaResultados(titulo);
  resultados.innerHTML = '';
  contador.textContent = '';
  btnVerMas.hidden = true;
  mensaje.textContent = idioma === 'es' ? 'Buscando y traduciendo...' : 'Buscando...';
  await cargarPagina();
}

// Carga las siguientes 20 recetas y las agrega abajo
async function cargarPagina() {
  if (busqueda.cargando) return;
  busqueda.cargando = true;
  btnVerMas.disabled = true;
  btnVerMas.textContent = 'Cargando...';
  const paramsActuales = busqueda.params;
  const esPrimeraPagina = busqueda.offset === 0;

  try {
    const datos = await pedir(
      '/api/recetas',
      { ...paramsActuales, offset: busqueda.offset },
      { signal: controladorBusqueda.signal }
    );
    if (paramsActuales !== busqueda.params) return; // ya se buscó otra cosa

    const recetas = Array.isArray(datos.recetas) ? datos.recetas : [];
    busqueda.total = Number(datos.total) || 0;
    busqueda.offset += recetas.length;
    mensaje.textContent = '';

    if (esPrimeraPagina && recetas.length === 0) {
      pintarVacio(
        resultados, '🤷', 'No se encontraron recetas.',
        paramsActuales.q ? 'Prueba con otra palabra, más general o en inglés.' : ''
      );
      return;
    }
    recetas.forEach((r) => resultados.appendChild(crearTarjeta(r)));
    actualizarPaginacion(recetas.length);
  } catch (err) {
    if (err.codigo === 'CANCELADO') return;
    mensaje.textContent = '';
    if (esPrimeraPagina) {
      pintarError(resultados, err, () => buscar(paramsActuales, busqueda.titulo));
    } else {
      // Falló "Ver más": dejamos lo que ya había y avisamos
      mostrarAviso(`${(INFO_ERRORES[err.codigo] || INFO_ERRORES.DESCONOCIDO).icono} ${err.message}`);
      btnVerMas.hidden = !(INFO_ERRORES[err.codigo]?.reintentar ?? true);
    }
  } finally {
    busqueda.cargando = false;
    btnVerMas.disabled = false;
    btnVerMas.textContent = 'Ver más recetas';
  }
}

function actualizarPaginacion(recibidas) {
  const hayMas = recibidas > 0 && busqueda.offset < busqueda.total;
  contador.textContent = hayMas
    ? `Mostrando ${busqueda.offset} de ${busqueda.total} recetas`
    : `Mostrando las ${busqueda.offset} recetas encontradas 🎉`;
  btnVerMas.hidden = !hayMas;
}

btnVerMas.addEventListener('click', cargarPagina);

// Tarjeta reutilizable (destacadas y resultados)
function crearTarjeta(r) {
  const tarjeta = document.createElement('article');
  tarjeta.className = 'tarjeta';
  tarjeta.innerHTML = `
    <img src="${escapar(r.imagen)}" alt="${escapar(r.titulo)}" loading="lazy">
    ${r.likes ? `<span class="likes">❤️ ${escapar(r.likes)}</span>` : ''}
    <div class="info">
      <h3>${escapar(r.titulo)}</h3>
      <small>⏱ ${escapar(r.minutos)} min · 🍽 ${escapar(r.porciones)} porciones</small>
    </div>
  `;
  protegerImagenes(tarjeta);
  tarjeta.addEventListener('click', () => verDetalle(r.id));
  return tarjeta;
}

// ---------------------------------------------------------------
// Detalle en el modal
// ---------------------------------------------------------------
async function verDetalle(id) {
  recetaAbierta = id;
  detalle.innerHTML = `<p class="cargando">${idioma === 'es' ? 'Cargando y traduciendo...' : 'Cargando...'}</p>`;
  if (!modal.open) modal.showModal();

  try {
    const r = await pedir(`/api/recetas/${encodeURIComponent(id)}`);
    if (recetaAbierta !== id) return;

    const ingredientes = Array.isArray(r.ingredientes) ? r.ingredientes : [];
    const pasos = Array.isArray(r.pasos) ? r.pasos : [];
    const linkFuente = r.fuente
      ? `<a href="${escapar(r.fuente)}" target="_blank" rel="noopener">fuente original</a>`
      : 'fuente original (no disponible)';

    detalle.innerHTML = `
      <h2>${escapar(r.titulo)}</h2>
      <img src="${escapar(r.imagen)}" alt="${escapar(r.titulo)}">
      <p>⏱ ${escapar(r.minutos)} min · 🍽 ${escapar(r.porciones)} porciones</p>
      <h3>Ingredientes</h3>
      ${ingredientes.length
        ? `<ul>${ingredientes.map((i) => `<li>${escapar(i)}</li>`).join('')}</ul>`
        : '<p>Esta receta no tiene ingredientes registrados.</p>'}
      <h3>Preparación</h3>
      ${pasos.length
        ? `<ol>${pasos.map((p) => `<li>${escapar(p)}</li>`).join('')}</ol>`
        : `<p>Consulta los pasos en la ${linkFuente}.</p>`}
    `;
    protegerImagenes(detalle);
  } catch (err) {
    if (recetaAbierta !== id) return;
    pintarError(detalle, err, () => verDetalle(id));
  }
}

cerrarModal.addEventListener('click', () => modal.close());
modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });
modal.addEventListener('close', () => { recetaAbierta = null; });

// Arranque
actualizarConexion();
marcarIdioma();
cargarInicio();
