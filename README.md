# 🍳 Recetario

Aplicación web para buscar recetas de cocina, hecha con **Node.js** y **Express**. Permite buscar por nombre o por categoría, ver la receta del día y las recetas más populares, y leer cada receta traducida al español.

## 🔌 APIs utilizadas

| API | Para qué se usa | ¿Requiere key? |
|---|---|---|
| [Spoonacular](https://spoonacular.com/food-api) | Fuente de todas las recetas: búsqueda, categorías, populares e información detallada (ingredientes y pasos). | ✅ Sí |
| [MyMemory](https://mymemory.translated.net/doc/spec.php) | Traduce las recetas del inglés al español (traductor por defecto). | ❌ No (opcional: correo para ampliar el límite) |
| [DeepL API Free](https://www.deepl.com/pro-api) | Traductor alternativo de mejor calidad. Si se configura, reemplaza a MyMemory. | ✅ Sí (opcional) |

> 🔒 **Seguridad:** el navegador nunca habla directo con estas APIs. Todas las peticiones pasan por el servidor de Express, que agrega las claves guardadas en el archivo `.env`. Así las API Keys nunca se exponen en el frontend.

## ✨ Funcionalidades

- 🔎 Búsqueda por texto (en español o inglés).
- 🏷️ Filtros por categoría: desayunos, comida, cena, postres, sopas, vegetariano, vegano, sin gluten y más.
- ⭐ Receta del día y recetas destacadas en la pantalla principal.
- ➕ Botón **"Ver más"** que carga 20 recetas adicionales por clic.
- 🌐 Selector de idioma **ES / EN**.
- ⚠️ Manejo de errores: sin conexión, servidor apagado, límite de peticiones, 404, respuestas vacías, imágenes rotas, etc.
- 📱 Diseño adaptable a celular.

## 🛠️ Tecnologías

- **Backend:** Node.js, Express, dotenv
- **Frontend:** HTML, CSS y JavaScript (sin frameworks)

## 🚀 Cómo ejecutarlo

### Requisitos
- [Node.js](https://nodejs.org/) **versión 18 o superior** (`node -v` para verificar).
- Una API Key gratuita de [Spoonacular](https://spoonacular.com/food-api/console#Dashboard).

### Pasos

1. **Clona el repositorio**
   ```bash
   git clone https://github.com/David08L-U/recetario.git
   cd recetario
   ```

2. **Instala las dependencias**
   ```bash
   npm install
   ```

3. **Crea tu archivo `.env`** a partir de la plantilla
   ```bash
   # Windows
   copy .env.example .env
   # macOS / Linux
   cp .env.example .env
   ```

4. **Agrega tus claves** en el archivo `.env`
   ```env
   SPOONACULAR_API_KEY=tu_api_key_de_spoonacular
   PORT=3000

   # Opcional — traducción
   MYMEMORY_EMAIL=tu_correo@ejemplo.com
   DEEPL_API_KEY=
   ```

5. **Inicia el servidor**
   ```bash
   npm run dev     # modo desarrollo (se reinicia al guardar cambios)
   # o
   npm start
   ```

6. **Abre la app** en tu navegador: 👉 [http://localhost:3000](http://localhost:3000)

## 📁 Estructura del proyecto

```
recetario/
├── public/
│   ├── index.html      # Página principal
│   ├── style.css       # Estilos
│   ├── script.js       # Lógica del frontend
│   └── 404.html        # Página de "no encontrado"
├── server.js           # Servidor Express (protege las API Keys)
├── package.json
├── .env.example        # Plantilla de variables de entorno
└── .gitignore          # Ignora .env y node_modules
```

## 📡 Endpoints del servidor

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/inicio?lang=es` | Receta del día y recetas destacadas |
| GET | `/api/recetas?q=pollo&lang=es` | Búsqueda por texto |
| GET | `/api/recetas?categoria=postres&offset=20` | Búsqueda por categoría (con paginación) |
| GET | `/api/recetas/:id?lang=es` | Detalle de una receta |

## ⚠️ Límites de los planes gratuitos

- **Spoonacular:** 150 puntos al día. Si se agotan, la app muestra un aviso y se reinicia al día siguiente.
- **MyMemory:** ~5,000 caracteres al día sin correo, ~50,000 con `MYMEMORY_EMAIL`.
- **DeepL Free:** 500,000 caracteres al mes.

Para ahorrar peticiones, el servidor guarda en memoria la pantalla principal del día y las traducciones ya hechas.

## 👤 Autor
**David** — Proyecto escolar de la materia de Desarrollo Web.
