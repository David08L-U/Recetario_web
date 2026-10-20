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
const TIEMPO_MAX_API = 10000;        // 10 s máximo esperando a Spoonacular
const TIEMPO_MAX_TRADUCCION = 8000;  // 8 s máximo por llamada al traductor

const KEY_CONFIGURADA = Boolean(API_KEY && API_KEY !== 'tu_api_key_aqui');
if (!KEY_CONFIGURADA) {
  console.warn('⚠️  Falta SPOONACULAR_API_KEY en el archivo .env');
}
console.log(`🌐 Traducción con: ${DEEPL_KEY ? 'DeepL' : 'MyMemory'}`);

// ===============================================================
// MANEJO DE ERRORES
// Todos los errores terminan como JSON: { error: "mensaje", codigo: "CODIGO" }
// El frontend usa "codigo" para decidir qué icono/acción mostrar.
// ===============================================================
class ErrorApp extends Error {
  constructor(status, mensaje, codigo) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
  }
}

// Traduce el código HTTP de Spoonacular a un error entendible
function errorDeSpoonacular(status, detalle = '') {
  switch (status) {
    case 401:
    case 403:
      return new ErrorApp(500, 'La API Key de Spoonacular no es válida. Revisa tu archivo .env', 'API_KEY');
    case 402:
      return new ErrorApp(429, 'Se acabaron las peticiones gratis de hoy en Spoonacular. Intenta mañana.', 'LIMITE_DIARIO');
    case 429:
      return new ErrorApp(429, 'Demasiadas peticiones seguidas. Espera unos segundos e intenta de nuevo.', 'DEMASIADAS_PETICIONES');
    case 404:
      return new ErrorApp(404, 'No se encontró la receta.', 'NO_ENCONTRADO');
    default:
      if (status >= 500) {
        return new ErrorApp(502, 'Spoonacular tiene problemas en este momento. Intenta más tarde.', 'ERROR_EXTERNO');
      }
      return new ErrorApp(502, `Error inesperado de Spoonacular (${status}) ${detalle}`.trim(), 'ERROR_EXTERNO');
  }
}

// Envuelve rutas async para que cualquier error llegue al manejador final
const manejar = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ===============================================================
// LÍMITE DE PETICIONES PROPIO
// Protege tus puntos de Spoonacular: máx. 60 peticiones por minuto por usuario.
// ===============================================================
const LIMITE_POR_MINUTO = 60;
const contadores = new Map();

function limitarPeticiones(req, res, next) {
  const ip = req.ip;
  const ahora = Date.now();
  const registro = contadores.get(ip);

  if (!registro || ahora - registro.inicio > 60000) {
    contadores.set(ip, { inicio: ahora, cuenta: 1 });
    return next();
  }
  registro.cuenta++;
  if (registro.cuenta > LIMITE_POR_MINUTO) {
    const espera = Math.ceil((60000 - (ahora - registro.inicio)) / 1000);
    res.set('Retry-After', String(espera));
    return next(new ErrorApp(429, `Vas muy rápido 😅 Espera ${espera} segundos.`, 'DEMASIADAS_PETICIONES'));
  }
  next();
}

// Limpia contadores viejos cada 5 minutos
setInterval(() => {
  const ahora = Date.now();
  for (const [ip, r] of contadores) if (ahora - r.inicio > 60000) contadores.delete(ip);
}, 5 * 60000).unref();

// ===============================================================
// MIDDLEWARES
// ===============================================================
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', limitarPeticiones);

// Si falta la API Key, todas las rutas /api responden con un error claro
app.use('/api', (req, res, next) => {
  if (!KEY_CONFIGURADA) {
    return next(new ErrorApp(500, 'El servidor no tiene configurada la API Key de Spoonacular (.env).', 'API_KEY'));
  }
  next();
});

// ===============================================================
// LLAMADA A SPOONACULAR (con tiempo límite y errores claros)
// ===============================================================
async function llamarApi(ruta, params = {}) {
  const url = new URL(API_BASE + ruta);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('apiKey', API_KEY);

  let respuesta;
  try {
    respuesta = await fetch(url, { signal: AbortSignal.timeout(TIEMPO_MAX_API) });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new ErrorApp(504, 'Spoonacular tardó demasiado en responder. Intenta de nuevo.', 'TIEMPO_AGOTADO');
    }
    // Sin internet en el servidor, DNS caído, etc.
    throw new ErrorApp(503, 'El servidor no pudo conectarse a Spoonacular. Revisa la conexión a internet.', 'SIN_CONEXION_API');
  }

  const restantes = respuesta.headers.get('x-api-quota-left');
  if (restantes !== null && Number(restantes) < 15) {
    console.warn(`⚠️  Quedan pocos puntos de Spoonacular hoy: ${restantes}`);
  }

  if (!respuesta.ok) {
    let detalle = '';
    try { detalle = (await respuesta.json()).message || ''; } catch {}
    console.error(`Spoonacular ${respuesta.status}: ${detalle}`);
    throw errorDeSpoonacular(respuesta.status, detalle);
  }

  try {
    return await respuesta.json();
  } catch {
    throw new ErrorApp(502, 'Spoonacular respondió con datos inválidos.', 'ERROR_EXTERNO');
  }
}

// Convierte una receta de Spoonacular al formato "tarjeta" que usa el frontend
// (con valores por defecto por si algún campo viene vacío)
function aTarjeta(r = {}) {
  return {
    id: r.id,
    titulo: r.title || 'Receta sin nombre',
    imagen: r.image || '',
    minutos: r.readyInMinutes ?? '?',
    porciones: r.servings ?? '?',
    likes: r.aggregateLikes || 0
  };
}

// Quita etiquetas HTML y recorta un texto (el resumen de Spoonacular trae HTML)
function textoPlano(html = '', max = 220) {
  const limpio = String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return limpio.length > max ? limpio.slice(0, max).trim() + '…' : limpio;
}

// ===============================================================
// TRADUCCIÓN
// - Con DEEPL_API_KEY en .env → usa DeepL (mejor calidad).
// - Sin ella → usa MyMemory (gratis, sin key).
// - Todo lo traducido se guarda en memoria para no repetir llamadas.
// - Si la traducción falla, NO rompe la app: se devuelve en inglés + aviso.
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

  const r = await fetch(url, { signal: AbortSignal.timeout(TIEMPO_MAX_TRADUCCION) });
  const d = await r.json();
  if (Number(d.responseStatus) !== 200 || d.quotaFinished || !d.responseData?.translatedText) {
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
      signal: AbortSignal.timeout(TIEMPO_MAX_TRADUCCION),
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
    if (!r.ok) throw new Error(`DeepL: ${r.status}${r.status === 456 ? ' (límite mensual agotado)' : ''}`);
    const d = await r.json();
    salida.push(...d.translations.map(t => t.text));
  }
  return salida;
}

// Traduce una lista de textos. Devuelve { textos, ok } (nunca lanza error)
async function traducir(textos, origen = 'en', destino = 'es') {
  const resultado = [...textos];
  const pendientes = [];

  textos.forEach((t, i) => {
    if (!t || !String(t).trim()) return;
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
    console.error('Traducción:', err.name === 'TimeoutError' ? 'tiempo agotado' : err.message);
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
  if (textos.length === 0) return true;
  const { textos: traducidos, ok } = await traducir(textos);
  destinos.forEach(([obj, k], i) => { obj[k] = traducidos[i]; });
  return ok;
}

const AVISO_TRADUCCION = 'No se pudo traducir todo (límite diario del traductor o sin conexión). Se muestra en inglés.';

// ===============================================================
// CATEGORÍAS
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

// ===============================================================
// RUTAS
// ===============================================================

// GET /api/recetas?q=pollo&categoria=cena&offset=20&lang=es
app.get('/api/recetas', manejar(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const categoria = String(req.query.categoria || '').trim();
  const offset = Math.min(Math.max(parseInt(req.query.offset, 10) || 0, 0), 900);
  const enEspanol = req.query.lang === 'es';

  if (!q && !categoria) {
    throw new ErrorApp(400, 'Escribe algo o elige una categoría.', 'PARAMETRO_INVALIDO');
  }
  if (q.length > 100) {
    throw new ErrorApp(400, 'La búsqueda es demasiado larga (máx. 100 caracteres).', 'PARAMETRO_INVALIDO');
  }
  if (categoria && !CATEGORIAS[categoria]) {
    throw new ErrorApp(400, 'Esa categoría no existe.', 'PARAMETRO_INVALIDO');
  }

  const params = {
    number: POR_PAGINA,
    offset,
    addRecipeInformation: true,
    sort: 'popularity',
    ...CATEGORIAS[categoria]
  };
  if (q) {
    // "pollo" → "chicken" para que Spoonacular lo entienda
    params.query = enEspanol ? (await traducir([q], 'es', 'en')).textos[0] : q;
  }

  const datos = await llamarApi('/recipes/complexSearch', params);
  const recetas = Array.isArray(datos.results) ? datos.results.map(aTarjeta) : [];
  const total = Number(datos.totalResults) || 0;

  let aviso;
  if (enEspanol && !(await traducirCampos(recetas, ['titulo']))) aviso = AVISO_TRADUCCION;

  // Respuesta vacía es válida (200): el frontend muestra "no hay resultados"
  res.json({ recetas, total: Math.min(total, 900 + POR_PAGINA), aviso });
}));

// GET /api/inicio?lang=es → receta del día + destacadas (caché diaria)
let cacheInicio = { fecha: null, datos: null };

app.get('/api/inicio', manejar(async (req, res) => {
  const hoy = new Date().toISOString().slice(0, 10);
  let avisoExtra;

  if (cacheInicio.fecha !== hoy) {
    try {
      const offset = Math.floor(Math.random() * 60);
      const datos = await llamarApi('/recipes/complexSearch', {
        sort: 'popularity',
        number: 9,
        offset,
        addRecipeInformation: true
      });

      const populares = Array.isArray(datos.results) ? datos.results : [];
      if (populares.length === 0) {
        throw new ErrorApp(502, 'Spoonacular no devolvió recetas populares.', 'RESPUESTA_VACIA');
      }

      const i = Math.floor(Math.random() * populares.length);
      const elegida = populares[i];
      cacheInicio = {
        fecha: hoy,
        datos: {
          delDia: { ...aTarjeta(elegida), resumen: textoPlano(elegida.summary) },
          destacadas: populares.filter((_, j) => j !== i).map(aTarjeta)
        }
      };
    } catch (err) {
      // Si falla pero tenemos datos de un día anterior, mejor mostrar esos
      if (!cacheInicio.datos) throw err;
      console.warn('Usando la pantalla principal de un día anterior:', err.message);
      avisoExtra = 'No se pudieron cargar las recetas de hoy; mostrando las anteriores.';
    }
  }

  const respuesta = structuredClone(cacheInicio.datos);
  if (req.query.lang === 'es') {
    const ok1 = await traducirCampos([respuesta.delDia], ['titulo', 'resumen']);
    const ok2 = await traducirCampos(respuesta.destacadas, ['titulo']);
    if (!ok1 || !ok2) respuesta.aviso = AVISO_TRADUCCION;
  }
  if (avisoExtra) respuesta.aviso = avisoExtra;
  res.json(respuesta);
}));

// GET /api/recetas/:id?lang=es → detalle de una receta
app.get('/api/recetas/:id', manejar(async (req, res) => {
  const { id } = req.params;
  if (!/^\d{1,10}$/.test(id)) {
    throw new ErrorApp(400, 'El ID de la receta no es válido.', 'PARAMETRO_INVALIDO');
  }

  const r = await llamarApi(`/recipes/${id}/information`);
  if (!r || !r.id) throw new ErrorApp(404, 'No se encontró la receta.', 'NO_ENCONTRADO');

  const receta = {
    id: r.id,
    titulo: r.title || 'Receta sin nombre',
    imagen: r.image || '',
    minutos: r.readyInMinutes ?? '?',
    porciones: r.servings ?? '?',
    ingredientes: (r.extendedIngredients || []).map(i => i.original).filter(Boolean),
    pasos: (r.analyzedInstructions?.[0]?.steps || []).map(p => p.step).filter(Boolean),
    fuente: r.sourceUrl || ''
  };

  if (req.query.lang === 'es') {
    const ok = await traducirCampos([receta], ['titulo', 'ingredientes', 'pasos']);
    if (!ok) receta.aviso = AVISO_TRADUCCION;
  }
  res.json(receta);
}));

// ===============================================================
// 404 y manejador final de errores (siempre al final)
// ===============================================================

// Ruta /api que no existe → JSON
app.use('/api', (req, res, next) => {
  next(new ErrorApp(404, `La ruta ${req.originalUrl} no existe.`, 'RUTA_NO_EXISTE'));
});

// Cualquier otra página que no existe → 404.html
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof ErrorApp) {
    return res.status(err.status).json({ error: err.message, codigo: err.codigo });
  }
  console.error('Error inesperado:', err);
  res.status(500).json({ error: 'Ocurrió un error inesperado en el servidor.', codigo: 'ERROR_INTERNO' });
});

// Errores que se escapan (para que el servidor no se caiga sin avisar)
process.on('unhandledRejection', (err) => console.error('Promesa sin manejar:', err));

const servidor = app.listen(PORT, () => {
  console.log(`🍳 Servidor en http://localhost:${PORT}`);
});

servidor.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ El puerto ${PORT} ya está en uso. Cierra el otro servidor o cambia PORT en .env`);
  } else {
    console.error('❌ No se pudo iniciar el servidor:', err.message);
  }
  process.exit(1);
});
