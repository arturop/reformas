
# GeoCatastro - Consulta Catastral por Coordenadas

Esta aplicación te permite obtener información catastral básica (referencia y dirección) para tu ubicación actual utilizando los servicios web de la Dirección General del Catastro de España.

## Funcionalidades

*   Obtiene tus coordenadas geográficas (latitud y longitud) usando la API de geolocalización del navegador.
*   Consulta el servicio web del Catastro para obtener información asociada a esas coordenadas.
*   Muestra la referencia catastral y la dirección si están disponibles.
*   Manejo de errores de geolocalización y del servicio del Catastro.
*   Advertencia sobre posibles problemas de "contenido mixto" (HTTP API desde página HTTPS) que podrían afectar la funcionalidad en algunos navegadores/entornos.

## Ejecutar Localmente

**Prerrequisitos:** Node.js

1.  Instala las dependencias:
    `npm install`
2.  Ejecuta la aplicación en modo desarrollo:
    `npm run dev`

La aplicación estará disponible en `http://localhost:5173` (o el puerto que Vite asigne).

## Despliegue (Ej. GitHub Pages)

1.  Asegúrate de que la propiedad `base` en `vite.config.ts` esté configurada correctamente con el nombre de tu repositorio (ej. `/reformas/`).
2.  Construye la aplicación:
    `npm run build`
3.  Despliega el contenido de la carpeta `dist` a tu servicio de hosting estático (como GitHub Pages).

**Nota Importante sobre el Servicio del Catastro:**
El servicio web del Catastro utilizado (`http://ovc.catastro.mineco.es/...`) opera sobre HTTP. Si despliegas esta aplicación en un entorno HTTPS (como GitHub Pages), los navegadores modernos podrían bloquear las solicitudes a este servicio por razones de seguridad (política de "contenido mixto"). Esto puede hacer que la consulta al Catastro no funcione. Una solución robusta para producción implicaría el uso de un backend que actúe como proxy y realice las llamadas al servicio del Catastro sobre HTTPS si es posible, o maneje la comunicación HTTP de forma segura.
