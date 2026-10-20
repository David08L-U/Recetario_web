// Carga las variables del archivo .env en process.env
require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.SPOONACULAR_API_KEY;
const API_BASE = 'https://api.spoonacular.com';

if (!API_KEY || API_KEY === 'tu_api_key_aqui') {
  console.warn('⚠️  Falta SPOONACULAR_API_KEY en el archivo .env');
}

// Sirve los archivos del frontend (index.html, style.css, script.js)
app.use(express.static(path.join(__dirname, 'public')));

// Función auxiliar: llama a la API externa agregando la key SOLO en el servidor
async function llamarApi(ruta, params = {}) {
  const url = new URL(API_BASE + ruta);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('apiKey', API_KEY);

  const respuesta = await fetch(url);
  if (!respuesta.ok) {
    const error = new Error(`Error de la API externa (${respuesta.status})`);
    error.status = respuesta.status;
    throw error;
  }
  return respuesta.json();
}

// GET /api/recetas?q=pasta  → busca recetas
app.get('/api/recetas', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Escribe algo para buscar' });

  try {
    const datos = await llamarApi('/recipes/complexSearch', {
      query: q,
      number: 12,
      addRecipeInformation: true
    });

    // Solo enviamos al navegador lo que necesita
    const recetas = datos.results.map(r => ({
      id: r.id,
      titulo: r.title,
      imagen: r.image,
      minutos: r.readyInMinutes,
      porciones: r.servings
    }));
    res.json(recetas);
  } catch (err) {
    console.error(err.message);
    res.status(err.status || 500).json({ error: 'No se pudieron obtener las recetas' });
  }
});

// GET /api/recetas/:id  → detalle de una receta
app.get('/api/recetas/:id', async (req, res) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const r = await llamarApi(`/recipes/${id}/information`);
    res.json({
      id: r.id,
      titulo: r.title,
      imagen: r.image,
      minutos: r.readyInMinutes,
      porciones: r.servings,
      ingredientes: r.extendedIngredients.map(i => i.original),
      pasos: r.analyzedInstructions[0]?.steps.map(p => p.step) || [],
      fuente: r.sourceUrl
    });
  } catch (err) {
    console.error(err.message);
    res.status(err.status || 500).json({ error: 'No se pudo obtener la receta' });
  }
});

app.listen(PORT, () => {
  console.log(`🍳 Servidor en http://localhost:${PORT}`);
});
