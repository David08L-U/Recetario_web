// Carga las variables del archivo .env en process.env
require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.SPOONACULAR_API_KEY;
const API_BASE = 'https://api.spoonacular.com';

// Traducción (opcionales, ver .env.example)
const DEEPL_KEY = process.env.DEEPL_API_KEY;        // si existe, se usa DeepL
const MYMEMORY_EMAIL = process.env.MYMEMORY_EMAIL;  // sube el límite gratis de MyMemory

const POR_PAGINA = 20;

if (!API_KEY || API_KEY === 'tu_api_key_aqui') {
  console.warn('⚠️  Falta SPOONACULAR_API_KEY en el archivo .env');
}
console.log(`🌐 Traducción con: ${DEEPL_KEY ? 'DeepL' : 'MyMemory'}`);

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

// Convierte una receta de Spoonacular al formato "tarjeta" que usa el frontend
function aTarjeta(r) {
  return {
    id: r.id,
    titulo: r.title,
    imagen: r.image,
    minutos: r.readyInMinutes,
    porciones: r.servings,
    likes: r.aggregateLikes || 0
  };
}

// Quita etiquetas HTML y recorta un texto (el resumen de Spoonacular trae HTML)
function textoPlano(html = '', max = 220) {
  const limpio = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return limpio.length > max ? limpio.slice(0, max).trim() + '…' : limpio;
}

// ===============================================================
// TRADUCCIÓN
// - Con DEEPL_API_KEY en .env → usa DeepL (mejor calidad).
// - Sin ella → usa MyMemory (gratis, sin key).
// - Todo lo traducido se guarda en memoria para no repetir llamadas.
// - Si la traducción falla, se devuelve el texto en inglés.
// ===============================================================
const cacheTraducciones = new Map();

// Ejecuta fn sobre cada elemento, máximo "limite" a la vez
async function enParalelo(items, limite, fn) {
  const salida = new Array(items.length);
  let siguiente = 0;
  async function trabajador() {
    while (siguiente < items.length) {
      const i = siguiente++;
      salida[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, trabajador));
  return salida;
}

// Parte un texto largo en trozos por oraciones (MyMemory acepta ~500 caracteres)
function trocear(texto, max = 450) {
  if (texto.length <= max) return [texto];
  const trozos = [];
  let actual = '';
  for (const oracion of texto.split(/(?<=[.!?;])\s+/)) {
    if ((actual + ' ' + oracion).length > max && actual) {
      trozos.push(actual);
      actual = oracion;
    } else {
      actual = actual ? actual + ' ' + oracion : oracion;
    }
  }
  if (actual) trozos.push(actual);
  // Oraciones gigantes sin punto: se cortan a la fuerza
  return trozos.flatMap(t => t.length <= max ? [t] : t.match(new RegExp(`.{1,${max}}`, 'g')));
}

function decodificarEntidades(t) {
  return t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

async function myMemoryUno(texto, origen, destino) {
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', texto);
  url.searchParams.set('langpair', `${origen}|${destino}`);
  if (MYMEMORY_EMAIL) url.searchParams.set('de', MYMEMORY_EMAIL);

  const r = await fetch(url);
  const d = await r.json();
  if (Number(d.responseStatus) !== 200 || d.quotaFinished) {
    throw new Error(`MyMemory: ${d.responseDetails || d.responseStatus}`);
  }
  return decodificarEntidades(d.responseData.translatedText);
}

async function conMyMemory(textos, origen, destino) {
  return enParalelo(textos, 4, async (texto) => {
    const partes = await Promise.all(trocear(texto).map(p => myMemoryUno(p, origen, destino)));
    return partes.join(' ');
  });
}

async function conDeepL(textos, origen, destino) {
  const host = DEEPL_KEY.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
  const salida = [];
  for (let i = 0; i < textos.length; i += 50) {           // DeepL: máx. 50 textos por llamada
    const r = await fetch(`https://${host}/v2/translate`, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${DEEPL_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: textos.slice(i, i + 50),
        source_lang: origen.toUpperCase(),
        target_lang: destino.toUpperCase()
      })
    });
    if (!r.ok) throw new Error(`DeepL: ${r.status}`);
    const d = await r.json();
    salida.push(...d.translations.map(t => t.text));
  }
  return salida;
}

// Traduce una lista de textos. Devuelve { textos, ok }
async function traducir(textos, origen = 'en', destino = 'es') {
  const resultado = [...textos];
  const pendientes = [];

  textos.forEach((t, i) => {
    if (!t || !t.trim()) return;
    const clave = `${origen}|${destino}|${t}`;
    if (cacheTraducciones.has(clave)) resultado[i] = cacheTraducciones.get(clave);
    else pendientes.push(i);
  });
  if (pendientes.length === 0) return { textos: resultado, ok: true };

  try {
    const originales = pendientes.map(i => textos[i]);
    const traducidos = DEEPL_KEY
      ? await conDeepL(originales, origen, destino)
      : await conMyMemory(originales, origen, destino);

    if (cacheTraducciones.size > 5000) cacheTraducciones.clear();
    pendientes.forEach((i, j) => {
      resultado[i] = traducidos[j];
      cacheTraducciones.set(`${origen}|${destino}|${textos[i]}`, traducidos[j]);
    });
    return { textos: resultado, ok: true };
  } catch (err) {
    console.error('Traducción:', err.message);
    return { textos: resultado, ok: false };
  }
}

// Traduce campos de objetos (strings o arrays de strings) en el mismo lugar
async function traducirCampos(objetos, campos) {
  const textos = [];
  const destinos = [];
  for (const o of objetos) {
    for (const c of campos) {
      const v = o[c];
      if (Array.isArray(v)) v.forEach((t, i) => { textos.push(t); destinos.push([v, i]); });
      else if (typeof v === 'string') { textos.push(v); destinos.push([o, c]); }
    }
  }
  const { textos: traducidos, ok } = await traducir(textos);
  destinos.forEach(([obj, k], i) => { obj[k] = traducidos[i]; });
  return ok;
}

const AVISO_TRADUCCION = 'No se pudo traducir todo (posible límite diario del traductor). Se muestra en inglés.';

// ===============================================================
// CATEGORÍAS: el frontend solo manda un nombre (ej. "postres") y
// aquí lo traducimos a los parámetros que entiende Spoonacular.
// ===============================================================
const CATEGORIAS = {
  desayunos:    { type: 'breakfast' },
  postres:      { type: 'dessert' },
  comida:       { type: 'main course' },
  cena:         { type: 'main course', maxReadyTime: 40 },
  entradas:     { type: 'appetizer' },
  sopas:        { type: 'soup' },
  ensaladas:    { type: 'salad' },
  bebidas:      { type: 'drink' },
  vegetariano:  { diet: 'vegetarian' },
  vegano:       { diet: 'vegan' },
  'sin-gluten': { diet: 'gluten free' }
};

// GET /api/recetas?q=pollo&categoria=cena&offset=20&lang=es
//  - q: texto (si lang=es se traduce al inglés antes de buscar)
//  - categoria: una de CATEGORIAS
//  - offset: desde qué resultado empezar (para "Ver más")
//  - lang=es: devuelve los títulos traducidos
app.get('/api/recetas', async (req, res) => {
  const q = (req.query.q || '').trim();
  const categoria = (req.query.categoria || '').trim();
  const offset = Math.min(Math.max(parseInt(req.query.offset, 10) || 0, 0), 900);
  const enEspanol = req.query.lang === 'es';

  if (!q && !categoria) {
    return res.status(400).json({ error: 'Escribe algo o elige una categoría' });
  }
  if (categoria && !CATEGORIAS[categoria]) {
    return res.status(400).json({ error: 'Categoría no válida' });
  }

  try {
    const params = {
      number: POR_PAGINA,
      offset,
      addRecipeInformation: true,
      sort: 'popularity',
      ...(CATEGORIAS[categoria] || {})
    };
    if (q) {
      // "pollo" → "chicken" para que Spoonacular lo entienda
      params.query = enEspanol ? (await traducir([q], 'es', 'en')).textos[0] : q;
    }

    const datos = await llamarApi('/recipes/complexSearch', params);
    const recetas = datos.results.map(aTarjeta);

    let aviso;
    if (enEspanol && !(await traducirCampos(recetas, ['titulo']))) aviso = AVISO_TRADUCCION;

    res.json({ recetas, total: Math.min(datos.totalResults, 900 + POR_PAGINA), aviso });
  } catch (err) {
    console.error(err.message);
    res.status(err.status || 500).json({ error: 'No se pudieron obtener las recetas' });
  }
});

// ===============================================================
// PANTALLA PRINCIPAL: receta del día + destacadas.
// Se piden a Spoonacular UNA vez al día y se guardan en memoria.
// ===============================================================
let cacheInicio = { fecha: null, datos: null };

app.get('/api/inicio', async (req, res) => {
  const hoy = new Date().toISOString().slice(0, 10);

  try {
    if (cacheInicio.fecha !== hoy) {
      const offset = Math.floor(Math.random() * 60);
      const datos = await llamarApi('/recipes/complexSearch', {
        sort: 'popularity',
        number: 9,
        offset,
        addRecipeInformation: true
      });

      const populares = datos.results;
      const i = Math.floor(Math.random() * populares.length);
      const elegida = populares[i];

      cacheInicio = {
        fecha: hoy,
        datos: {
          delDia: { ...aTarjeta(elegida), resumen: textoPlano(elegida.summary) },
          destacadas: populares.filter((_, j) => j !== i).map(aTarjeta)
        }
      };
    }

    // Copia para no modificar la caché en inglés al traducir
    const respuesta = structuredClone(cacheInicio.datos);
    if (req.query.lang === 'es') {
      const ok1 = await traducirCampos([respuesta.delDia], ['titulo', 'resumen']);
      const ok2 = await traducirCampos(respuesta.destacadas, ['titulo']);
      if (!ok1 || !ok2) respuesta.aviso = AVISO_TRADUCCION;
    }
    res.json(respuesta);
  } catch (err) {
    console.error(err.message);
    res.status(err.status || 500).json({ error: 'No se pudo cargar la pantalla principal' });
  }
});

// GET /api/recetas/:id?lang=es  → detalle de una receta
app.get('/api/recetas/:id', async (req, res) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const r = await llamarApi(`/recipes/${id}/information`);
    const receta = {
      id: r.id,
      titulo: r.title,
      imagen: r.image,
      minutos: r.readyInMinutes,
      porciones: r.servings,
      ingredientes: r.extendedIngredients.map(i => i.original),
      pasos: r.analyzedInstructions[0]?.steps.map(p => p.step) || [],
      fuente: r.sourceUrl
    };

    if (req.query.lang === 'es') {
      const ok = await traducirCampos([receta], ['titulo', 'ingredientes', 'pasos']);
      if (!ok) receta.aviso = AVISO_TRADUCCION;
    }
    res.json(receta);
  } catch (err) {
    console.error(err.message);
    res.status(err.status || 500).json({ error: 'No se pudo obtener la receta' });
  }
});

app.listen(PORT, () => {
  console.log(`🍳 Servidor en http://localhost:${PORT}`);
});
