import React, { useState, useCallback, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";

// Asumimos que process.env.API_KEY está disponible en el entorno de ejecución.
// ADVERTENCIA: Esto NO funcionará de forma segura en un despliegue de frontend puro en GitHub Pages
// sin un backend proxy o un proceso de compilación que lo maneje adecuadamente (y de forma segura).
// La API Key quedaría expuesta si se inyecta directamente en el cliente.
const API_KEY = process.env.API_KEY;

const App: React.FC = () => {
  const [coordinates, setCoordinates] = useState<GeolocationCoordinates | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState<boolean>(false);
  const [isNonSecureContext, setIsNonSecureContext] = useState<boolean>(false);

  const [propertyInfo, setPropertyInfo] = useState<string | null>(null);
  const [propertyInfoError, setPropertyInfoError] = useState<string | null>(null);
  const [isFetchingPropertyInfo, setIsFetchingPropertyInfo] = useState<boolean>(false);

  let ai: GoogleGenAI | null = null;
  if (API_KEY) {
    ai = new GoogleGenAI({ apiKey: API_KEY });
  } else {
    console.warn("API_KEY de Gemini no está configurada. La funcionalidad de información de propiedad estará deshabilitada.");
  }

  useEffect(() => {
    if (
      window.location.protocol !== 'https:' &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1'
    ) {
      setIsNonSecureContext(true);
    }
  }, []);

  const fetchPropertyInfoFromGemini = async (coords: GeolocationCoordinates) => {
    if (!ai) {
      setPropertyInfoError("La API de Gemini no está configurada (falta API_KEY).");
      setIsFetchingPropertyInfo(false);
      return;
    }

    setIsFetchingPropertyInfo(true);
    setPropertyInfo(null);
    setPropertyInfoError(null);

    const prompt = `Eres un asistente experto en información inmobiliaria y de áreas locales.
    Basándote en las siguientes coordenadas: Latitud ${coords.latitude}, Longitud ${coords.longitude}.
    Proporciona una descripción concisa del tipo de propiedad o terreno que probablemente se encuentre allí.
    Incluye cualquier punto de interés cercano notable, usos potenciales y el carácter general estimado del área.
    Si es un edificio, menciona su tipo potencial (residencial, comercial, industrial, etc.).
    Si es un terreno baldío, describe sus características y posibles usos.
    Sé descriptivo pero breve.`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-04-17', // Modelo recomendado para tareas de texto generales
        contents: [{ role: "user", parts: [{text: prompt}] }],
      });
      
      setPropertyInfo(response.text);
    } catch (e: any) {
      console.error("Error al obtener información de propiedad de Gemini:", e);
      setPropertyInfoError(`Error al contactar la API de Gemini: ${e.message}. Asegúrate de que la API Key es válida y tiene permisos.`);
    } finally {
      setIsFetchingPropertyInfo(false);
    }
  };

  const handleGetLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError("La geolocalización no es compatible con tu navegador.");
      setIsLoadingLocation(false);
      return;
    }

    setIsLoadingLocation(true);
    setLocationError(null);
    setCoordinates(null);
    setPropertyInfo(null);
    setPropertyInfoError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoordinates(position.coords);
        setIsLoadingLocation(false);
        if (API_KEY) {
          fetchPropertyInfoFromGemini(position.coords);
        } else {
           setPropertyInfoError("Funcionalidad no disponible: API Key de Gemini no configurada.");
        }
      },
      (err) => {
        let errorMessage = "Ocurrió un error al obtener la ubicación.";
        switch (err.code) {
          case err.PERMISSION_DENIED:
            errorMessage = "Permiso de ubicación denegado. Por favor, habilita el acceso a la ubicación en la configuración de tu navegador o para este sitio.";
            break;
          case err.POSITION_UNAVAILABLE:
            errorMessage = "Información de ubicación no disponible en este momento.";
            break;
          case err.TIMEOUT:
            errorMessage = "Se agotó el tiempo de espera para obtener la ubicación.";
            break;
        }
        setLocationError(errorMessage);
        setIsLoadingLocation(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  }, [API_KEY]); // Añadimos API_KEY a las dependencias por si cambiara, aunque es improbable con process.env

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-600 to-indigo-700 flex flex-col items-center justify-center p-4 sm:p-6 text-white font-sans antialiased">
      <div className="bg-white bg-opacity-25 backdrop-blur-lg shadow-2xl rounded-xl p-6 sm:p-8 max-w-lg w-full text-center transform transition-all duration-500 hover:scale-105">
        <header className="mb-6 sm:mb-8">
          <div className="flex justify-center items-center mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 sm:w-16 sm:h-16 text-indigo-200">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
            </svg>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">GeoInfo AI</h1>
          <p className="text-indigo-200 mt-2 text-sm sm:text-base">Tu ubicación e información de la propiedad con IA.</p>
        </header>

        <main>
          {isNonSecureContext && !locationError && (
            <div role="alert" className="bg-yellow-500 bg-opacity-90 text-yellow-900 p-4 rounded-md mb-6 shadow-lg text-left">
              <div className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mr-2">
                   <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <h3 className="font-semibold text-lg">Atención:</h3>
              </div>
              <p className="mt-1 ml-8 text-sm sm:text-base">
                Para una detección de ubicación fiable, esta aplicación debe usarse en un contexto seguro (HTTPS). 
                Es posible que tu navegador no solicite permiso o bloquee la geolocalización en conexiones HTTP. 
                Intenta acceder a la aplicación mediante HTTPS.
              </p>
            </div>
          )}

          <button
            onClick={handleGetLocation}
            disabled={isLoadingLocation || isFetchingPropertyInfo || !API_KEY}
            className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-indigo-300 focus:ring-opacity-50 mb-6 text-lg"
            aria-live="polite"
          >
            {isLoadingLocation ? 'Obteniendo Ubicación...' : isFetchingPropertyInfo ? 'Analizando con IA...' : 'Obtener Ubicación e Info de Propiedad'}
          </button>
          {!API_KEY && (
            <div role="alert" className="bg-red-700 bg-opacity-90 text-white p-3 rounded-md mb-4 shadow text-xs">
              La funcionalidad de información de propiedad está deshabilitada. Falta la API Key de Gemini.
            </div>
          )}

          {locationError && (
            <div role="alert" className="bg-red-500 bg-opacity-90 text-white p-4 rounded-md mb-6 shadow-lg text-left">
              <div className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mr-2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <h3 className="font-semibold text-lg">Error de Ubicación:</h3>
              </div>
              <p className="mt-1 ml-8 text-sm sm:text-base">{locationError}</p>
            </div>
          )}

          {coordinates && !locationError && (
            <div className="bg-green-500 bg-opacity-90 text-white p-4 sm:p-6 rounded-md shadow-lg space-y-2 sm:space-y-3 text-left mb-6">
              <h2 className="text-xl sm:text-2xl font-semibold mb-2 sm:mb-3 text-center">¡Ubicación Encontrada!</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
                <div className="bg-green-600 bg-opacity-50 p-3 rounded-md">
                  <p className="text-xs sm:text-sm text-green-100">Latitud:</p>
                  <p className="text-lg sm:text-xl font-medium">{coordinates.latitude.toFixed(6)}</p>
                </div>
                <div className="bg-green-600 bg-opacity-50 p-3 rounded-md">
                  <p className="text-xs sm:text-sm text-green-100">Longitud:</p>
                  <p className="text-lg sm:text-xl font-medium">{coordinates.longitude.toFixed(6)}</p>
                </div>
              </div>
              {coordinates.accuracy && (
                <div className="bg-green-600 bg-opacity-50 p-3 rounded-md mt-2 sm:mt-3">
                  <p className="text-xs sm:text-sm text-green-100">Precisión:</p> 
                  <p className="text-base sm:text-lg font-medium">{coordinates.accuracy.toFixed(2)} metros</p>
                </div>
              )}
            </div>
          )}
          
          {isFetchingPropertyInfo && (
            <div className="flex items-center justify-center text-lg p-4 my-4 bg-blue-500 bg-opacity-80 rounded-md">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Consultando a Gemini AI...
            </div>
          )}

          {propertyInfoError && (
             <div role="alert" className="bg-orange-500 bg-opacity-90 text-white p-4 rounded-md mb-6 shadow-lg text-left">
              <div className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mr-2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <h3 className="font-semibold text-lg">Error de Información de Propiedad:</h3>
              </div>
              <p className="mt-1 ml-8 text-sm sm:text-base">{propertyInfoError}</p>
            </div>
          )}

          {propertyInfo && !propertyInfoError && (
            <div className="bg-purple-500 bg-opacity-90 text-white p-4 sm:p-6 rounded-md shadow-lg space-y-2 sm:space-y-3 text-left">
              <h2 className="text-xl sm:text-2xl font-semibold mb-2 sm:mb-3 text-center">Información de la Propiedad (por Gemini AI)</h2>
              <div className="bg-purple-600 bg-opacity-50 p-3 rounded-md prose prose-sm sm:prose-base prose-invert max-w-none">
                {/* Usamos whitespace-pre-wrap para respetar saltos de línea y espacios de la respuesta de Gemini */}
                <p style={{ whiteSpace: 'pre-wrap' }}>{propertyInfo}</p>
              </div>
            </div>
          )}

          {!isLoadingLocation && !isFetchingPropertyInfo && !locationError && !coordinates && !isNonSecureContext && (
             <p className="text-indigo-200 text-sm sm:text-base mt-4">
              {API_KEY ? "Haz clic en el botón para obtener tu ubicación e información de la propiedad." : "Configura la API Key de Gemini para activar la búsqueda de información."}
             </p>
          )}
        </main>
      </div>
      <footer className="mt-8 text-center text-indigo-300 text-xs sm:text-sm">
        <p>&copy; {new Date().getFullYear()} GeoInfo AI. Potenciado por Gemini.</p>
      </footer>
    </div>
  );
};

export default App;
