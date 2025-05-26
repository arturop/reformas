
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
// Fix: Import necessary modules for ESM __dirname equivalent
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Fix: Define __filename and __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/', // Ajustado para despliegue en la raíz de Vercel
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'), // Permite importar desde la raíz del proyecto con @/
    }
  },
  server: {
    port: 3000, // Puedes cambiar el puerto si lo deseas
    open: true // Abre automáticamente el navegador al iniciar el servidor de desarrollo
  }
})
