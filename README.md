# GeoCatastro - Consulta Catastral por Coordenadas

Esta aplicación te permite obtener información catastral básica (referencia y dirección) para tu ubicación actual utilizando los servicios web de la Dirección General del Catastro de España.

## Funcionalidades

*   Obtiene tus coordenadas geográficas (latitud y longitud) usando la API de geolocalización del navegador.
*   Consulta el servicio web del Catastro (HTTPS) para obtener información asociada a esas coordenadas.
*   Muestra la referencia catastral y la dirección si están disponibles.
*   Manejo de errores de geolocalización y del servicio del Catastro.
*   Advertencia sobre posibles problemas de CORS o red al contactar el servicio externo del Catastro.
*   Interfaz responsiva y moderna construida con React, TypeScript y Tailwind CSS.

## Ejecutar Localmente

**Prerrequisitos:** Node.js (v18+) y npm/yarn.

1.  **Clona el repositorio** (si es un proyecto separado) o asegúrate de tener todos los archivos (`index.html`, `App.tsx`, `index.tsx`, `package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.js`).

2.  **Navega a la carpeta del proyecto** en tu terminal.

3.  **Instala las dependencias:**
    ```bash
    npm install
    ```
    o si usas yarn:
    ```bash
    yarn install
    ```

4.  **Ejecuta la aplicación en modo desarrollo:**
    ```bash
    npm run dev
    ```
    o
    ```bash
    yarn dev
    ```
    La aplicación estará disponible generalmente en `http://localhost:5173` (Vite te indicará la URL exacta).

## Archivos de Configuración Clave

*   **`vite.config.ts`**: Configuración para Vite, incluyendo la base para despliegues.
*   **`tailwind.config.js`**: Configuración de Tailwind CSS.
*   **`postcss.config.js`**: Configuración de PostCSS (usualmente para Tailwind y Autoprefixer).
*   **`tsconfig.json`**: Configuración del compilador de TypeScript.

## Despliegue

Para desplegar esta aplicación (por ejemplo, en GitHub Pages):

1.  **Ajusta `base` en `vite.config.ts`**:
    Si vas a desplegar en un subdirectorio (ej. `https://tu-usuario.github.io/tu-repositorio/`), actualiza la propiedad `base` en `vite.config.ts`:
    ```javascript
    // vite.config.ts
    export default defineConfig({
      base: '/tu-repositorio/', // Ajusta esto al nombre de tu repositorio
      plugins: [react()],
      // ... otras configuraciones
    });
    ```
    Si despliegas en la raíz de un dominio, `base` puede ser `'/'`.

2.  **Construye la aplicación:**
    ```bash
    npm run build
    ```
    o
    ```bash
    yarn build
    ```
    Esto generará una carpeta `dist` con los archivos estáticos listos para el despliegue.

3.  **Despliega la carpeta `dist`** a tu proveedor de hosting estático preferido.

### Ejemplo: Despliegue en GitHub Pages

Puedes usar GitHub Actions para automatizar el despliegue. Un workflow típico (ej. `.github/workflows/deploy.yml`) construiría y desplegaría la rama `gh-pages`.

**Importante sobre el Servicio del Catastro y CORS:**
El servicio web del Catastro (`https://ovc.catastro.mineco.es/...`) opera sobre HTTPS. Sin embargo, como con cualquier API externa, pueden existir restricciones de CORS (Cross-Origin Resource Sharing) que impidan que tu aplicación (especialmente si está alojada en un dominio diferente como `github.io`) haga solicitudes directas desde el navegador.

Si experimentas errores al obtener la información catastral (especialmente errores de red o `Failed to fetch` en la consola del navegador), CORS podría ser la causa. Para una producción robusta, una solución común es usar un backend propio (un proxy) que reciba la solicitud desde tu frontend, luego llame al servicio del Catastro desde el servidor (donde las restricciones CORS no aplican de la misma manera), y finalmente devuelva la respuesta a tu frontend.
