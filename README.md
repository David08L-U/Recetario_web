# 🍳 Recetario

Aplicación web para buscar recetas de cocina, desarrollada con **Node.js** y **Express**. Permite buscar recetas por nombre o por categoría, ver la receta del día y las recetas destacadas, cargar más resultados con "Ver más", traducir las recetas al español y cambiar entre modo claro y modo oscuro.

**APIs externas utilizadas:**
- **[Spoonacular](https://spoonacular.com/food-api):** fuente de las recetas (búsqueda, categorías, populares y detalle).
- **[MyMemory](https://mymemory.translated.net/)** / **[DeepL](https://www.deepl.com/pro-api)** (opcional): traducción de las recetas del inglés al español.

> 🔒 Las API Keys se guardan en un archivo `.env` y solo las usa el servidor; el navegador nunca las ve.

---

## 🤖 Declaración de uso de herramientas de IA

En este proyecto se utilizaron herramientas de inteligencia artificial como apoyo. A continuación se detalla para qué se usó cada una y cuál fue mi aporte personal.

| Herramienta | Fase | Uso |
|---|---|---|
| **Gemini** | Planeación | Utilizado en la fase inicial del proyecto para realizar la planeación, investigar qué API externa gratuita convenía utilizar (Spoonacular) y definir la estructura de carpetas y seguridad del proyecto (`.env`). |
| **Claude** | Desarrollo | Utilizado para la generación del código fuente. Se encargó de escribir la lógica del servidor en Node.js, las peticiones `fetch` y la estructura base de HTML y CSS. |

### 👤 Mi aporte sin IA

- Implementación de la funcionalidad de **"Modo Oscuro"**, manipulando directamente el DOM con JavaScript y creando las variables de color en CSS.
- **Revisión lógica** del código generado.
- **Ensamblaje** de los archivos del proyecto.
- **Pruebas** de la interfaz de usuario.

---

## 🚀 Instrucciones de ejecución

### Requisitos
- [Node.js](https://nodejs.org/) **versión 18 o superior** (verifícalo con `node -v`).
- Una API Key gratuita de [Spoonacular](https://spoonacular.com/food-api/console#Dashboard).

### Pasos

1. **Clonar el repositorio**
   ```bash
   git clone https://github.com/David08L-U/recetario.git
   cd recetario
   ```

2. **Instalar las dependencias**
   ```bash
   npm install
   ```

3. **Crear el archivo `.env`** a partir de la plantilla
   ```bash
   # Windows
   copy .env.example .env
   # macOS / Linux
   cp .env.example .env
   ```

4. **Agregar las claves** en el archivo `.env`
   ```env
   SPOONACULAR_API_KEY=tu_api_key_de_spoonacular
   PORT=3000

   # Opcional — traducción
   MYMEMORY_EMAIL=tu_correo@ejemplo.com
   DEEPL_API_KEY=
   ```

5. **Iniciar el servidor**
   ```bash
   npm run dev     # modo desarrollo (se reinicia al guardar cambios)
   # o
   npm start
   ```

6. **Abrir la aplicación** en el navegador: 👉 [http://localhost:3000](http://localhost:3000)

### Estructura del proyecto

```
recetario/
├── public/
│   ├── index.html      # Página principal
│   ├── style.css       # Estilos (incluye variables de color del modo oscuro)
│   ├── script.js       # Lógica del frontend
│   └── 404.html        # Página de "no encontrado"
├── server.js           # Servidor Express (protege las API Keys)
├── package.json
├── .env.example        # Plantilla de variables de entorno
└── .gitignore          # Ignora .env y node_modules
```

> ⚠️ **Planes gratuitos:** Spoonacular permite 150 puntos al día y MyMemory ~5,000 caracteres al día (~50,000 si configuras `MYMEMORY_EMAIL`). Si se agotan, la app muestra un aviso.

---

## 👤 Autor

**David** — Proyecto escolar de la materia de Desarrollo Web.
