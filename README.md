# GeoCatastro - Consulta Catastral por Coordenadas

Esta aplicación te permite obtener información catastral básica (referencia y dirección) para tu ubicación actual utilizando los servicios web de la Dirección General del Catastro de España.

## Funcionalidades

*   Obtiene tus coordenadas geográficas (latitud y longitud) usando la API de geolocalización del navegador.
*   Consulta el servicio web del Catastro (HTTPS) para obtener información asociada a esas coordenadas.
*   Muestra la referencia catastral y la dirección si están disponibles.
*   Manejo de errores de geolocalización y del servicio del Catastro.
*   Advertencia sobre posibles problemas de CORS o red al contactar el servicio externo del Catastro.

## Ejecutar Localmente

**Prerrequisitos:** Node.js

1.  Clona el repositorio (si aún no lo has hecho).
2.  Navega a la carpeta del proyecto.
3.  Instala las dependencias:
    ```bash
    npm install
    ```
4.  Ejecuta la aplicación en modo desarrollo:
    ```bash
    npm run dev
    ```
La aplicación estará disponible en `http://localhost:5173` (o el puerto que Vite asigne).

## Despliegue en GitHub Pages (Automatizado con GitHub Actions)

Para que la aplicación funcione correctamente en GitHub Pages y se actualice automáticamente cada vez que envías cambios a tu rama `main`, utilizamos GitHub Actions. Esto **elimina la necesidad de ejecutar `npm run build` localmente** para el despliegue.

**Pasos para activar el despliegue automático:**

1.  **Configura `base` en `vite.config.ts`:**
    Asegúrate de que la propiedad `base` en `vite.config.ts` esté configurada con el nombre de tu repositorio. Por ejemplo, si tu repositorio es `https://github.com/tu-usuario/reformas`, la base debe ser `'/reformas/'`.
    ```javascript
    // vite.config.ts
    export default defineConfig({
      base: '/reformas/', // Ajusta esto al nombre de tu repositorio
      // ... otras configuraciones
    });
    ```
    Este paso es crucial para que los enlaces a los archivos (CSS, JS) funcionen correctamente en GitHub Pages.

2.  **Commit y Push del Workflow:**
    El archivo `.github/workflows/deploy.yml` (que se incluye en estos cambios) define el proceso de build y despliegue. Simplemente haz commit y push de este archivo a tu repositorio.

3.  **Configura GitHub Pages en tu Repositorio:**
    a.  Una vez que el workflow se haya ejecutado por primera vez después de un push a `main` (puedes verificarlo en la pestaña "Actions" de tu repositorio), creará una nueva rama llamada `gh-pages` (o la que se configure en el workflow).
    b.  Ve a la configuración de tu repositorio en GitHub: `Settings` > `Pages`.
    c.  En "Build and deployment", bajo "Source", selecciona "Deploy from a branch".
    d.  Elige la rama `gh-pages` como fuente y la carpeta `/(root)` (ya que la rama `gh-pages` contendrá directamente los archivos de la carpeta `dist`).
    e.  Guarda los cambios.

¡Eso es todo! Ahora, cada vez que hagas `git push` a tu rama `main`, GitHub Actions construirá tu aplicación y la desplegará. Tu sitio en GitHub Pages se actualizará automáticamente. La URL será algo como `https://tu-usuario.github.io/reformas/`.

**Importante sobre el Servicio del Catastro y CORS:**
El servicio web del Catastro (`https://ovc.catastro.mineco.es/...`) opera sobre HTTPS. Sin embargo, como con cualquier API externa, pueden existir restricciones de CORS (Cross-Origin Resource Sharing) que impidan que tu aplicación (alojada en `github.io`) haga solicitudes directas desde el navegador. Si experimentas errores al obtener la información catastral, CORS podría ser la causa. Para producción robusta, una solución común es usar un backend propio que actúe como proxy para las solicitudes al servicio del Catastro.
