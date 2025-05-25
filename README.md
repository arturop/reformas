# GeoCatastro - Consulta Catastral por Coordenadas

Esta aplicación te permite obtener información catastral básica (referencia y dirección) para tu ubicación actual utilizando los servicios web de la Dirección General del Catastro de España, a través de un proxy desplegado en Vercel.

## Funcionalidades

*   Obtiene tus coordenadas geográficas (latitud y longitud) usando la API de geolocalización del navegador.
*   Envía las coordenadas (actualmente de ejemplo) a un proxy en Vercel.
*   El proxy consulta el servicio web SOAP del Catastro para obtener información asociada a esas coordenadas.
*   Muestra la referencia catastral y la dirección si están disponibles.
*   Manejo de errores de geolocalización, del proxy y del servicio del Catastro.
*   Interfaz responsiva y moderna construida con React, TypeScript y Tailwind CSS.

## Arquitectura

*   **Frontend:** Aplicación React (Vite + TypeScript + Tailwind CSS).
*   **Backend (Proxy):** Una función serverless de Vercel (Node.js/TypeScript) ubicada en el directorio `/api`. Esta función recibe las solicitudes del frontend, llama al servicio SOAP del Catastro y devuelve la respuesta. Esto evita problemas de CORS que ocurrirían con llamadas directas desde el navegador.

## Ejecutar Localmente con Vercel CLI

**Prerrequisitos:** Node.js (v18+), npm/yarn, y [Vercel CLI](https://vercel.com/docs/cli).

1.  **Clona el repositorio** (si es un proyecto separado) o asegúrate de tener todos los archivos.

2.  **Navega a la carpeta del proyecto** en tu terminal.

3.  **Instala las dependencias:**
    ```bash
    npm install
    # o si usas yarn:
    # yarn install
    ```

4.  **Inicia sesión en Vercel CLI (si es la primera vez):**
    ```bash
    vercel login
    ```

5.  **Ejecuta la aplicación en modo desarrollo con Vercel CLI:**
    ```bash
    vercel dev
    ```
    Esto iniciará tanto el frontend de Vite como las funciones serverless de la carpeta `/api`. La aplicación estará disponible generalmente en una URL como `http://localhost:3000` (Vercel CLI te indicará la URL exacta).

## Archivos de Configuración Clave

*   **`vite.config.ts`**: Configuración para Vite. La propiedad `base` podría necesitar ajuste dependiendo de la configuración de tu proyecto en Vercel.
*   **`api/catastro-proxy.ts`**: La función serverless que actúa como proxy.
*   **`tailwind.config.js`**: Configuración de Tailwind CSS.
*   **`postcss.config.js`**: Configuración de PostCSS.
*   **`tsconfig.json`**: Configuración del compilador de TypeScript para el frontend.

## Despliegue en Vercel

1.  **Asegúrate de tener una cuenta en Vercel** y haber conectado tu repositorio de GitHub/GitLab/Bitbucket a Vercel.

2.  **Configuración del Proyecto en Vercel:**
    *   Vercel generalmente detectará que es un proyecto Vite y configurará los ajustes de construcción automáticamente.
    *   Framework Preset: Vite
    *   Build Command: `vite build` (o `npm run build`)
    *   Output Directory: `dist`
    *   Install Command: `npm install` (o `yarn install`)
    *   Las funciones en el directorio `/api` serán desplegadas automáticamente.

3.  **Haz push de tus cambios a la rama conectada con Vercel (ej. `main`).** Vercel construirá y desplegará tu aplicación y el proxy.

**Importante sobre el Servicio del Catastro:**
*   La aplicación utiliza coordenadas UTM de **ejemplo**. La transformación de Latitud/Longitud (obtenidas del navegador) a UTM EPSG:25830 (requeridas por el servicio SOAP) aún es una tarea pendiente.
*   El servicio del Catastro puede tener sus propios límites de tasa o tiempos de inactividad.
