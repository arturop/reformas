/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./App.tsx",
    "./index.tsx",
    "./lib/**/*.ts", // If you add components with Tailwind classes here
    // Add other specific paths if you have UI components elsewhere
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
