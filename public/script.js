// Referencias al DOM
const form = document.getElementById('form-busqueda');
const input = document.getElementById('input-busqueda');
const resultados = document.getElementById('resultados');
const mensaje = document.getElementById('mensaje');
const modal = document.getElementById('modal');
const detalle = document.getElementById('detalle');
const cerrarModal = document.getElementById('cerrar-modal');

// El navegador llama a NUESTRO servidor, nunca directo a la API externa.
// Así la API Key nunca llega al frontend.

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;

  mensaje.textContent = 'Buscando...';
  resultados.innerHTML = '';

  try {
    const res = await fetch(`/api/recetas?q=${encodeURIComponent(q)}`);
    const datos = await res.json();
    if (!res.ok) throw new Error(datos.error);

    if (datos.length === 0) {
      mensaje.textContent = 'No se encontraron recetas 😕';
      return;
    }
    mensaje.textContent = '';
    mostrarRecetas(datos);
  } catch (err) {
    mensaje.textContent = err.message || 'Ocurrió un error';
  }
});

function mostrarRecetas(recetas) {
  recetas.forEach((r) => {
    const tarjeta = document.createElement('article');
    tarjeta.className = 'tarjeta';
    tarjeta.innerHTML = `
      <img src="${r.imagen}" alt="${r.titulo}">
      <div class="info">
        <h3>${r.titulo}</h3>
        <small>⏱ ${r.minutos} min · 🍽 ${r.porciones} porciones</small>
      </div>
    `;
    tarjeta.addEventListener('click', () => verDetalle(r.id));
    resultados.appendChild(tarjeta);
  });
}

async function verDetalle(id) {
  detalle.innerHTML = '<p>Cargando...</p>';
  modal.showModal();

  try {
    const res = await fetch(`/api/recetas/${id}`);
    const r = await res.json();
    if (!res.ok) throw new Error(r.error);

    detalle.innerHTML = `
      <h2>${r.titulo}</h2>
      <img src="${r.imagen}" alt="${r.titulo}">
      <p>⏱ ${r.minutos} min · 🍽 ${r.porciones} porciones</p>
      <h3>Ingredientes</h3>
      <ul>${r.ingredientes.map((i) => `<li>${i}</li>`).join('')}</ul>
      <h3>Preparación</h3>
      ${r.pasos.length
        ? `<ol>${r.pasos.map((p) => `<li>${p}</li>`).join('')}</ol>`
        : `<p>Consulta los pasos en la <a href="${r.fuente}" target="_blank">fuente original</a>.</p>`}
    `;
  } catch (err) {
    detalle.innerHTML = `<p>${err.message || 'Error al cargar la receta'}</p>`;
  }
}

cerrarModal.addEventListener('click', () => modal.close());
