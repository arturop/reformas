
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
    // const env = loadEnv(mode, '.', ''); // No es necesario si no cargamos GEMINI_API_KEY
    return {
      base: '/reformas/', // Asegúrate de que 'reformas' es el nombre de tu repositorio
      // define: { // Ya no se necesita definir la API_KEY de Gemini
      //   'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      //   'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      // },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
