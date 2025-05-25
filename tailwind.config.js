/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./app.html", // Updated from index.html
    "./**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'], // Ejemplo de fuente personalizada
      },
      backdropBlur: {
        lg: '12px',
      }
    },
  },
  plugins: [],
}