// Referencias al DOM
const form = document.getElementById('form-busqueda');
const input = document.getElementById('input-busqueda');
const logo = document.getElementById('logo');
const chips = document.querySelectorAll('.chip');
const botonesIdioma = document.querySelectorAll('.idioma button');

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
const busqueda = {                   // búsqueda actual (para "Ver más")
  params: null,
  titulo: '',
  offset: 0,
  total: 0,
  cargando: false
};

// Evita que texto de la API se interprete como HTML
function escapar(texto = '') {
  return String(texto).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
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

// Pide JSON a nuestro servidor agregando el idioma
async function pedir(ruta, params = {}) {
  const url = ruta + '?' + new URLSearchParams({ ...params, lang: idioma });
  const res = await fetch(url);
  const datos = await res.json();
  if (!res.ok) throw new Error(datos.error);
  mostrarAviso(datos.aviso);
  return datos;
}

// ---------------------------------------------------------------
// NUEVO: Idioma (ES / EN), se recuerda en el navegador
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

    // Recargar lo que se está viendo en el nuevo idioma
    if (!vistaResultados.hidden && busqueda.params) buscar(busqueda.params, busqueda.titulo);
    else cargarInicio();
    if (modal.open && recetaAbierta) verDetalle(recetaAbierta);
  });
});

// ---------------------------------------------------------------
// Cambiar entre pantalla principal y resultados
// ---------------------------------------------------------------
function mostrarInicio() {
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
    pintarRecetaDelDia(datos.delDia);
    datos.destacadas.forEach((r) => destacadas.appendChild(crearTarjeta(r)));
  } catch (err) {
    recetaDelDia.innerHTML = `<p class="cargando">${escapar(err.message || 'No se pudo cargar la pantalla principal')}</p>`;
  }
}

function pintarRecetaDelDia(r) {
  recetaDelDia.innerHTML = `
    <img src="${escapar(r.imagen)}" alt="${escapar(r.titulo)}">
    <div class="hero-info">
      <span class="etiqueta">⭐ Receta del día</span>
      <h2>${escapar(r.titulo)}</h2>
      <p class="resumen">${escapar(r.resumen)}</p>
      <p class="meta">⏱ ${r.minutos} min · 🍽 ${r.porciones} porciones · ❤️ ${r.likes}</p>
      <button class="btn-primario" id="btn-ver-dia">Ver receta</button>
    </div>
  `;
  document.getElementById('btn-ver-dia').addEventListener('click', () => verDetalle(r.id));
}

// ---------------------------------------------------------------
// Búsqueda por texto y por categoría
// ---------------------------------------------------------------
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
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

// Búsqueda nueva: limpia todo y carga la primera página
async function buscar(params, titulo) {
  Object.assign(busqueda, { params, titulo, offset: 0, total: 0 });
  mostrarVistaResultados(titulo);
  resultados.innerHTML = '';
  contador.textContent = '';
  btnVerMas.hidden = true;
  mensaje.textContent = 'Buscando...';
  await cargarPagina();
}

// NUEVO: carga las siguientes 20 recetas y las agrega abajo
async function cargarPagina() {
  if (busqueda.cargando) return;
  busqueda.cargando = true;
  btnVerMas.disabled = true;
  btnVerMas.textContent = 'Cargando...';
  const paramsActuales = busqueda.params;

  try {
    const datos = await pedir('/api/recetas', { ...paramsActuales, offset: busqueda.offset });
    if (paramsActuales !== busqueda.params) return; // el usuario ya buscó otra cosa

    busqueda.total = datos.total;
    busqueda.offset += datos.recetas.length;

    if (busqueda.offset === 0) {
      mensaje.textContent = 'No se encontraron recetas 😕';
      return;
    }
    mensaje.textContent = '';
    datos.recetas.forEach((r) => resultados.appendChild(crearTarjeta(r)));
    actualizarPaginacion(datos.recetas.length);
  } catch (err) {
    if (busqueda.offset === 0) mensaje.textContent = err.message || 'Ocurrió un error';
    else mostrarAviso(err.message || 'No se pudieron cargar más recetas');
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
    ${r.likes ? `<span class="likes">❤️ ${r.likes}</span>` : ''}
    <div class="info">
      <h3>${escapar(r.titulo)}</h3>
      <small>⏱ ${r.minutos} min · 🍽 ${r.porciones} porciones</small>
    </div>
  `;
  tarjeta.addEventListener('click', () => verDetalle(r.id));
  return tarjeta;
}

// ---------------------------------------------------------------
// Detalle en el modal
// ---------------------------------------------------------------
async function verDetalle(id) {
  recetaAbierta = id;
  detalle.innerHTML = `<p>${idioma === 'es' ? 'Cargando y traduciendo...' : 'Cargando...'}</p>`;
  if (!modal.open) modal.showModal();

  try {
    const r = await pedir(`/api/recetas/${id}`);
    if (recetaAbierta !== id) return;

    detalle.innerHTML = `
      <h2>${escapar(r.titulo)}</h2>
      <img src="${escapar(r.imagen)}" alt="${escapar(r.titulo)}">
      <p>⏱ ${r.minutos} min · 🍽 ${r.porciones} porciones</p>
      <h3>Ingredientes</h3>
      <ul>${r.ingredientes.map((i) => `<li>${escapar(i)}</li>`).join('')}</ul>
      <h3>Preparación</h3>
      ${r.pasos.length
        ? `<ol>${r.pasos.map((p) => `<li>${escapar(p)}</li>`).join('')}</ol>`
        : `<p>Consulta los pasos en la <a href="${escapar(r.fuente)}" target="_blank" rel="noopener">fuente original</a>.</p>`}
    `;
  } catch (err) {
    detalle.innerHTML = `<p>${escapar(err.message || 'Error al cargar la receta')}</p>`;
  }
}

cerrarModal.addEventListener('click', () => modal.close());
modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });
modal.addEventListener('close', () => { recetaAbierta = null; });

// Arranque
marcarIdioma();
cargarInicio();
