// Referencias al DOM
const form = document.getElementById('form-busqueda');
const input = document.getElementById('input-busqueda');
const logo = document.getElementById('logo');
const chips = document.querySelectorAll('.chip');

const vistaInicio = document.getElementById('inicio');
const recetaDelDia = document.getElementById('receta-del-dia');
const destacadas = document.getElementById('destacadas');

const vistaResultados = document.getElementById('vista-resultados');
const tituloResultados = document.getElementById('titulo-resultados');
const btnVolver = document.getElementById('btn-volver');
const resultados = document.getElementById('resultados');
const mensaje = document.getElementById('mensaje');

const modal = document.getElementById('modal');
const detalle = document.getElementById('detalle');
const cerrarModal = document.getElementById('cerrar-modal');

// El navegador llama a NUESTRO servidor, nunca directo a la API externa.
// Así la API Key nunca llega al frontend.

// Evita que texto de la API se interprete como HTML
function escapar(texto = '') {
  return String(texto).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

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
// NUEVO: Pantalla principal (receta del día + destacadas)
// ---------------------------------------------------------------
async function cargarInicio() {
  try {
    const res = await fetch('/api/inicio');
    const datos = await res.json();
    if (!res.ok) throw new Error(datos.error);

    pintarRecetaDelDia(datos.delDia);
    destacadas.innerHTML = '';
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
// Búsqueda por texto y por categoría (usan la misma función)
// ---------------------------------------------------------------
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  marcarChip(null);
  buscar({ q }, `Resultados para "${q}"`);
});

// NUEVO: clic en un botón de categoría
chips.forEach((chip) => {
  chip.addEventListener('click', () => {
    const categoria = chip.dataset.categoria;
    input.value = '';
    marcarChip(categoria);
    buscar({ categoria }, chip.textContent.trim());
  });
});

async function buscar(params, titulo) {
  mostrarVistaResultados(titulo);
  mensaje.textContent = 'Buscando...';
  resultados.innerHTML = '';

  try {
    const res = await fetch('/api/recetas?' + new URLSearchParams(params));
    const datos = await res.json();
    if (!res.ok) throw new Error(datos.error);

    if (datos.length === 0) {
      mensaje.textContent = 'No se encontraron recetas 😕';
      return;
    }
    mensaje.textContent = '';
    datos.forEach((r) => resultados.appendChild(crearTarjeta(r)));
  } catch (err) {
    mensaje.textContent = err.message || 'Ocurrió un error';
  }
}

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
  detalle.innerHTML = '<p>Cargando...</p>';
  modal.showModal();

  try {
    const res = await fetch(`/api/recetas/${id}`);
    const r = await res.json();
    if (!res.ok) throw new Error(r.error);

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
// Cerrar el modal al hacer clic fuera de él
modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });

// Arranque
cargarInicio();
