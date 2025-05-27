
import React, { useState, useCallback, useEffect } from 'react';
import proj4 from 'proj4';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import type { TaxonomyNode, ClassifiedJobInfo } from './types'; // Explicit relative path
import taxonomyData from './taxonomy.json'; // Explicit relative path

import './lib/projDefs'; // Ensure EPSG:23030 definition is loaded (side-effect import)

// Existing CatastroInfoData and ProxyResponse types
interface CatastroInfoData {
  referenciaOriginal: string | null;
  direccionOriginalLDT: string | null;
  distancia: number | null;
  datosDetallados: {
    direccionCompleta: string | null;
    usoPrincipal: string | null;
    superficie: string | null;
    antiguedad?: string | null;
    valorCatastral?: string | null;
  } | null;
  message?: string;
}

type ProxyErrorResponse = { 
  error: string; 
  details?: string; 
  referenciaOriginal?: string | null;
  direccionOriginalLDT?: string | null;
  distancia?: number | null;
  message?: string;
};
type ProxySuccessResponse = CatastroInfoData;
type ProxyResponse = ProxyErrorResponse | ProxySuccessResponse;

// Initialize Gemini AI Client
let ai: GoogleGenAI | null = null;
const apiKey = import.meta.env.VITE_API_KEY;

if (apiKey) {
  ai = new GoogleGenAI({ apiKey });
} else {
  console.error("VITE_API_KEY environment variable not set. Job classification will not work.");
}

const App: React.FC = () => {
  // --- Job Classification States ---
  const [userJobRequestText, setUserJobRequestText] = useState<string>('');
  const [classifiedJobInfo, setClassifiedJobInfo] = useState<ClassifiedJobInfo | null>(null);
  const [isClassifyingJob, setIsClassifyingJob] = useState<boolean>(false);
  const [classificationError, setClassificationError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<'jobInput' | 'catastroView'>('jobInput');

  // --- GeoCatastro States (existing) ---
  const [coordinates, setCoordinates] = useState<GeolocationCoordinates | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState<boolean>(false);
  const [isNonSecureContext, setIsNonSecureContext] = useState<boolean>(false);
  const [catastroInfo, setCatastroInfo] = useState<CatastroInfoData | null>(null);
  const [catastroError, setCatastroError] = useState<string | null>(null);
  const [isFetchingCatastroInfo, setIsFetchingCatastroInfo] = useState<boolean>(false);
  const [showApiWarning, setShowApiWarning] = useState<boolean>(true);
  const [utmCoordinatesForDisplay, setUtmCoordinatesForDisplay] = useState<{x: number, y: number, srs: string} | null>(null);

  useEffect(() => {
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setIsNonSecureContext(true);
    }
  }, []);

  // --- Job Classification Logic ---
  const handleClassifyJob = async () => {
    if (!userJobRequestText.trim()) {
      setClassificationError("Por favor, describe el trabajo que necesitas.");
      return;
    }
    if (!ai) {
      setClassificationError("El servicio de clasificación no está disponible (API Key no configurada correctamente).");
      console.error("Gemini AI client not initialized. Ensure VITE_API_KEY is set.");
      return;
    }

    setIsClassifyingJob(true);
    setClassificationError(null);
    setClassifiedJobInfo(null);

    const prompt = `
Analiza la siguiente descripción de un proyecto de reforma proporcionada por el usuario.
Tu tarea es clasificar esta descripción según la siguiente taxonomía de trabajos de reforma.
Identifica el trabajo más específico y relevante de la taxonomía que coincida con la descripción del usuario.
Asegúrate de ser robusto a pequeños errores ortográficos o gramaticales en la entrada del usuario.

Taxonomía:
${JSON.stringify(taxonomyData, null, 2)}

Descripción del usuario:
"${userJobRequestText}"

Debes devolver tu respuesta ÚNICAMENTE en formato JSON con la siguiente estructura:
{
  "job_id": "string (el ID del nodo de la taxonomía coincidente, ej. IV.11.1)",
  "job_label": "string (la etiqueta 'label' del nodo de la taxonomía coincidente, ej. 'Bañera → plato de ducha')",
  "level": "number (el nivel 'level' del nodo de la taxonomía coincidente, ej. 4)",
  "confidence_score": "number (un valor entre 0.0 y 1.0 que indique tu confianza en la clasificación, siendo 1.0 la máxima confianza)",
  "raw_user_text": "string (el texto original del usuario que has analizado)"
}

Asegúrate de que 'job_id', 'job_label' y 'level' correspondan exactamente a un nodo existente en la taxonomía proporcionada.
Si la descripción es ambigua o no encaja claramente, elige el nodo más apropiado y refleja la incertidumbre en 'confidence_score'.
La 'raw_user_text' debe ser una copia exacta del texto del usuario.
`;

    try {
      // Note: The 'contents' structure for Gemini has evolved. 
      // The models.generateContent expects `contents: string` or `contents: { parts: Part[] }` or `contents: Content[]`.
      // For a simple text prompt, a direct string or the object structure is fine.
      // Using `[{ role: "user", parts: [{text: prompt}] }]` is more aligned with chat history but works.
      // A simpler `contents: prompt` would also work for single-turn text.
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-04-17', 
        contents: prompt, // Simplified for single text prompt
        config: {
          responseMimeType: "application/json",
        },
      });

      let jsonStr = response.text.trim();
      const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
      const match = jsonStr.match(fenceRegex);
      if (match && match[2]) {
        jsonStr = match[2].trim();
      }
      
      const resultData = JSON.parse(jsonStr) as ClassifiedJobInfo;

      if (resultData && typeof resultData.job_id === 'string' && typeof resultData.job_label === 'string') {
        setClassifiedJobInfo(resultData);
      } else {
        throw new Error("Respuesta de clasificación inválida o formato incorrecto.");
      }

    } catch (error: any) {
      console.error("Error clasificando el trabajo:", error);
      setClassificationError(`Error al clasificar: ${error.message || 'Ocurrió un error desconocido.'}`);
      setClassifiedJobInfo(null);
    } finally {
      setIsClassifyingJob(false);
    }
  };
  
  const proceedToCatastroView = () => {
    if (classifiedJobInfo) {
      setCurrentStep('catastroView');
      setCoordinates(null);
      setLocationError(null);
      setCatastroInfo(null);
      setCatastroError(null);
      setUtmCoordinatesForDisplay(null);
    }
  };


  // --- GeoCatastro Logic (existing, slightly adapted) ---
  const fetchCatastroInfo = async (geoCoords: GeolocationCoordinates) => {
    setIsFetchingCatastroInfo(true);
    setCatastroInfo(null);
    setCatastroError(null);
    setUtmCoordinatesForDisplay(null);

    let utmX: number;
    let utmY: number;
    const srsForCatastro = "EPSG:23030";
    
    try {
      const wgs84 = 'EPSG:4326';
      const targetSrs = srsForCatastro;
      const [lon, lat] = [geoCoords.longitude, geoCoords.latitude];
      const transformedCoords = proj4(wgs84, targetSrs, [lon, lat]);
      utmX = transformedCoords[0];
      utmY = transformedCoords[1];
      setUtmCoordinatesForDisplay({ x: parseFloat(utmX.toFixed(2)), y: parseFloat(utmY.toFixed(2)), srs: targetSrs });
    } catch (projError: any) {
        console.error("Error en la transformación de coordenadas:", projError);
        setCatastroError(`Error al transformar coordenadas a ${srsForCatastro}: ${projError.message}`);
        setIsFetchingCatastroInfo(false);
        return;
    }
        
    const proxyApiUrl = `/api/catastro-proxy`;
    
    try {
      const response = await fetch(proxyApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ utmX, utmY, srs: srsForCatastro }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Error from proxy: Status ${response.status}`, errorText);
        setCatastroError(`Error del servidor (proxy): ${response.status} - ${errorText.substring(0, 150)}${errorText.length > 150 ? '...' : ''}`);
        setCatastroInfo(null);
        setIsFetchingCatastroInfo(false);
        return;
      }

      const jsonData = await response.json() as ProxyResponse;

      if ('error' in jsonData) {
        const errorResponse = jsonData as ProxyErrorResponse;
        const errorMessage = errorResponse.details || errorResponse.error || JSON.stringify(jsonData);
        console.error("Error devuelto en JSON por el proxy o Catastro:", errorMessage, JSON.stringify(jsonData, null, 2));
        setCatastroError(`Error del servicio: ${errorMessage}.`);
        
        if (errorResponse.referenciaOriginal || errorResponse.message) {
            setCatastroInfo({
                referenciaOriginal: errorResponse.referenciaOriginal || null,
                direccionOriginalLDT: errorResponse.direccionOriginalLDT || null,
                distancia: errorResponse.distancia || null,
                datosDetallados: null,
                message: errorResponse.message || "No se pudieron obtener todos los detalles.",
            });
        }
      } else {
        setCatastroInfo(jsonData as ProxySuccessResponse);
        if (jsonData.message) { 
            console.info("Mensaje del proxy Catastro:", jsonData.message);
        }
      }
    } catch (e: any) {
      console.error("Error al procesar la solicitud al proxy del Catastro:", e);
      if (e instanceof SyntaxError && e.message.toLowerCase().includes('json')) {
        setCatastroError(`Error: La respuesta del proxy no fue JSON válido a pesar de un estado OK. ${e.message}`);
      } else {
        setCatastroError(`Error de red o al procesar la solicitud al proxy: ${e.message}`);
      }
    } finally {
      setIsFetchingCatastroInfo(false);
    }
  };

  useEffect(() => {
    if (coordinates && currentStep === 'catastroView') { // Only fetch if in catastro view and coords are set
      fetchCatastroInfo(coordinates);
    }
  }, [coordinates, currentStep]);

  const handleGetLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError("La geolocalización no es compatible con tu navegador.");
      setIsLoadingLocation(false);
      return;
    }

    setIsLoadingLocation(true);
    setLocationError(null);
    setCoordinates(null); 
    setCatastroInfo(null);
    setCatastroError(null);
    setUtmCoordinatesForDisplay(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoordinates(position.coords); 
        setIsLoadingLocation(false);
      },
      (err) => {
        let errorMessage = "Ocurrió un error al obtener la ubicación.";
        switch (err.code) {
          case err.PERMISSION_DENIED:
            errorMessage = "Permiso de ubicación denegado. Por favor, habilita el acceso a la ubicación.";
            break;
          case err.POSITION_UNAVAILABLE:
            errorMessage = "Información de ubicación no disponible.";
            break;
          case err.TIMEOUT:
            errorMessage = "Se agotó el tiempo de espera para obtener la ubicación.";
            break;
        }
        setLocationError(errorMessage);
        setIsLoadingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);

  // --- UI Rendering ---
  const renderCatastroData = () => {
    if (!catastroInfo) return null;
    if (!catastroInfo.referenciaOriginal && catastroInfo.message) return null;

    return (
      <div className="space-y-4" role="region" aria-labelledby="catastro-data-heading">
        <h3 id="catastro-data-heading" className="sr-only">Información Catastral Detallada</h3>
        {catastroInfo.referenciaOriginal && (
            <div className="p-4 bg-white rounded-lg shadow-lg">
                <h4 className="text-lg font-semibold text-slate-700 mb-2">Finca Más Cercana</h4>
                <p className="text-sm text-slate-600"><strong>Ref. Catastral:</strong> {catastroInfo.referenciaOriginal}</p>
                {catastroInfo.direccionOriginalLDT && <p className="text-sm text-slate-600"><strong>Localización (LDT):</strong> {catastroInfo.direccionOriginalLDT}</p>}
                {catastroInfo.distancia !== null && typeof catastroInfo.distancia === 'number' && (
                    <p className="text-sm text-slate-600"><strong>Distancia Aprox.:</strong> {catastroInfo.distancia.toFixed(2)} metros</p>
                )}
            </div>
        )}
        {catastroInfo.datosDetallados && (
          <div className="p-4 bg-white rounded-lg shadow-lg">
            <h4 className="text-lg font-semibold text-slate-700 mb-2">Detalles de la Finca</h4>
            {catastroInfo.datosDetallados.direccionCompleta && <p className="text-sm text-slate-600"><strong>Dirección Completa:</strong> {catastroInfo.datosDetallados.direccionCompleta}</p>}
            {catastroInfo.datosDetallados.usoPrincipal && <p className="text-sm text-slate-600"><strong>Uso Principal:</strong> {catastroInfo.datosDetallados.usoPrincipal}</p>}
            {catastroInfo.datosDetallados.superficie && <p className="text-sm text-slate-600"><strong>Superficie:</strong> {catastroInfo.datosDetallados.superficie}</p>}
            {catastroInfo.datosDetallados.antiguedad && <p className="text-sm text-slate-600"><strong>Antigüedad Construcción:</strong> {catastroInfo.datosDetallados.antiguedad}</p>}
            {catastroInfo.datosDetallados.valorCatastral && <p className="text-sm text-slate-600"><strong>Valor Catastral:</strong> {catastroInfo.datosDetallados.valorCatastral}</p>} 
          </div>
        )}
        {catastroInfo.message && catastroInfo.referenciaOriginal && (!catastroInfo.datosDetallados || Object.values(catastroInfo.datosDetallados).every(v => v === null || v === 'N/A' || v === '')) && (
             <div className="p-3 bg-amber-100 border-l-4 border-amber-500 text-amber-700 rounded" role="status">
                <p className="font-bold">Nota Adicional</p>
                <p>{catastroInfo.message}</p>
             </div>
        )}
      </div>
    );
  };
  
  const renderCoordinatesData = () => {
    if (!coordinates && !utmCoordinatesForDisplay) return null;
    return (
      <div className="space-y-4 mt-4" role="region" aria-labelledby="coordinates-data-heading">
         <h3 id="coordinates-data-heading" className="sr-only">Datos de Coordenadas</h3>
        {coordinates && !locationError && (
          <div className="p-4 bg-white rounded-lg shadow-lg">
            <h4 className="text-lg font-semibold text-slate-700 mb-2">Coordenadas Geográficas (WGS84)</h4>
            <p className="text-sm text-slate-600"><strong>Latitud:</strong> {coordinates.latitude.toFixed(6)}</p>
            <p className="text-sm text-slate-600"><strong>Longitud:</strong> {coordinates.longitude.toFixed(6)}</p>
            {coordinates.accuracy && <p className="text-sm text-slate-600"><strong>Precisión:</strong> {coordinates.accuracy.toFixed(1)} metros</p>}
          </div>
        )}
        {utmCoordinatesForDisplay && (
            <div className="p-4 bg-white rounded-lg shadow-lg">
                <h4 className="text-lg font-semibold text-slate-700 mb-2">Coordenadas UTM ({utmCoordinatesForDisplay.srs})</h4>
                <p className="text-sm text-slate-600"><strong>X:</strong> {utmCoordinatesForDisplay.x.toLocaleString()}</p>
                <p className="text-sm text-slate-600"><strong>Y:</strong> {utmCoordinatesForDisplay.y.toLocaleString()}</p>
            </div>
        )}
      </div>
    );
  };

  const renderGeoCatastroAlerts = () => {
    if (locationError) {
      return (
        <div className="mb-4 p-3 bg-red-100 border-l-4 border-red-500 text-red-700 rounded" role="alert">
          <p className="font-bold">Error de Geolocalización</p>
          <p>{locationError}</p>
        </div>
      );
    }
    if (catastroError) {
      return (
        <div className="mb-4 p-3 bg-red-100 border-l-4 border-red-500 text-red-700 rounded" role="alert">
          <p className="font-bold">Error de Información Catastral</p>
          <p>{catastroError}</p>
          {catastroInfo && catastroInfo.referenciaOriginal && catastroInfo.message && renderCatastroData()}
        </div>
      );
    }
    if (catastroInfo && !catastroInfo.referenciaOriginal && catastroInfo.message) {
        return (
            <div className="mt-4 p-3 bg-amber-100 border-l-4 border-amber-500 text-amber-700 rounded" role="status">
                <p className="font-bold">Sin Parcela Catastral</p>
                <p>{catastroInfo.message}</p>
                <p className="text-sm mt-1">Quizá tu ubicación esté en el límite entre parcelas o fuera de una zona con datos catastrales disponibles.</p>
            </div>
        );
    }
    if (coordinates && !isLoadingLocation && !isFetchingCatastroInfo && !catastroError && !locationError && !catastroInfo) {
        return (
            <div className="mt-4 p-3 bg-amber-100 border-l-4 border-amber-500 text-amber-700 rounded" role="status">
                <p>No se pudo obtener información catastral para la ubicación. El servicio del Catastro no devolvió datos o hubo un problema en la comunicación.</p>
            </div>
        );
    }
    return null;
  }

  // --- Conditional Rendering for Steps ---
  if (currentStep === 'jobInput') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-sky-600 to-indigo-700 flex flex-col items-center justify-center p-4 sm:p-6 text-white font-sans antialiased">
        <div className="bg-white bg-opacity-25 backdrop-blur-lg shadow-2xl rounded-xl p-6 sm:p-8 max-w-lg w-full text-slate-800">
          <header className="mb-6 text-center">
            <h1 className="text-4xl font-bold text-slate-700">Describa su Proyecto</h1>
            <p className="text-sm text-slate-600 mt-1">Ayúdenos a entender qué necesita para ofrecerle la mejor información.</p>
          </header>

          {!apiKey && ( // Check if the original apiKey constant is falsy
            <div className="mb-4 p-3 bg-red-100 border-l-4 border-red-500 text-red-700 rounded" role="alert">
                <p className="font-bold">Servicio no disponible</p>
                <p className="text-sm">La clasificación de proyectos no está disponible actualmente. Por favor, asegúrese de que la API Key de Gemini (VITE_API_KEY) esté configurada en las variables de entorno de Vercel.</p>
            </div>
          )}

          <div className="mb-4">
            <label htmlFor="jobRequestText" className="block text-sm font-medium text-slate-700 mb-1">
              ¿Qué tipo de reforma o trabajo necesita?
            </label>
            <textarea
              id="jobRequestText"
              rows={4}
              className="w-full p-2 border border-slate-300 rounded-md shadow-sm focus:ring-cyan-500 focus:border-cyan-500 text-slate-700 placeholder-slate-400"
              placeholder="Ej: Quiero cambiar la bañera por un plato de ducha y pintar el salón."
              value={userJobRequestText}
              onChange={(e) => setUserJobRequestText(e.target.value)}
              aria-label="Descripción del proyecto de reforma"
              disabled={isClassifyingJob || !ai}
            />
          </div>

          <button
            onClick={handleClassifyJob}
            disabled={isClassifyingJob || !userJobRequestText.trim() || !ai}
            className="w-full bg-cyan-500 hover:bg-cyan-600 text-white font-semibold py-3 px-4 rounded-lg shadow-md transition-colors duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-opacity-75 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-live="polite"
            aria-busy={isClassifyingJob}
          >
            {isClassifyingJob && <span className="inline-block animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-2"></span>}
            {isClassifyingJob ? 'Clasificando Proyecto...' : 'Clasificar Proyecto'}
          </button>

          {classificationError && (
            <div className="mt-4 p-3 bg-red-100 border-l-4 border-red-500 text-red-700 rounded" role="alert">
              <p className="font-bold">Error de Clasificación</p>
              <p>{classificationError}</p>
            </div>
          )}

          {classifiedJobInfo && (
            <div className="mt-6 p-4 bg-green-50 border-l-4 border-green-500 text-green-700 rounded-lg shadow">
              <h3 className="text-lg font-semibold text-green-800 mb-2">Proyecto Identificado</h3>
              <p><strong>Tipo de Trabajo:</strong> {classifiedJobInfo.job_label}</p>
              <p><strong>Confianza:</strong> {(classifiedJobInfo.confidence_score * 100).toFixed(0)}%</p>
              <p className="text-xs mt-1"><strong>ID:</strong> {classifiedJobInfo.job_id}, <strong>Nivel:</strong> {classifiedJobInfo.level}</p>
              <button
                onClick={proceedToCatastroView}
                className="mt-4 w-full bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded-lg shadow-md transition-colors duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-opacity-75"
              >
                Continuar y Obtener Datos Catastrales
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- GeoCatastro View (currentStep === 'catastroView') ---
  let geoCatastroButtonText = 'Obtener Ubicación y Datos Catastrales';
  let isGeoCatastroButtonBusy = isLoadingLocation || isFetchingCatastroInfo;
  if (isLoadingLocation) {
    geoCatastroButtonText = 'Obteniendo Ubicación...';
  } else if (isFetchingCatastroInfo) {
    geoCatastroButtonText = 'Consultando Catastro...';
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-600 to-indigo-700 flex flex-col items-center justify-center p-4 sm:p-6 text-white font-sans antialiased">
      <div className="bg-white bg-opacity-25 backdrop-blur-lg shadow-2xl rounded-xl p-6 sm:p-8 max-w-lg w-full text-slate-800">
        <button 
            onClick={() => {
                setCurrentStep('jobInput');
            }}
            className="mb-4 text-sm text-cyan-600 hover:text-cyan-800 underline"
            aria-label="Volver a describir el proyecto"
        >
            &larr; Cambiar descripción del proyecto
        </button>
        <header className="mb-6 text-center">
          <h1 className="text-4xl font-bold text-slate-700">GeoCatastro</h1>
          <p className="text-sm text-slate-600 mt-1">Consulta la información catastral de tu ubicación</p>
        </header>

        {classifiedJobInfo && (
          <div className="mb-6 p-4 bg-blue-50 border-l-4 border-blue-500 text-blue-700 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-blue-800 mb-2">Proyecto Seleccionado</h3>
            <p><strong>Tipo de Trabajo:</strong> {classifiedJobInfo.job_label}</p>
            <p><strong>Confianza de Clasificación:</strong> {(classifiedJobInfo.confidence_score * 100).toFixed(0)}%</p>
            <p className="text-xs mt-1"><strong>ID de Trabajo:</strong> {classifiedJobInfo.job_id}</p>
          </div>
        )}

        {isNonSecureContext && (
          <div className="mb-4 p-3 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 rounded" role="alert">
            <p className="font-bold">Atención: Contexto no seguro</p>
            <p className="text-sm">La geolocalización podría no funcionar correctamente. Accede via HTTPS.</p>
          </div>
        )}

        {showApiWarning && (
            <div className="mb-4 p-3 bg-blue-100 border-l-4 border-blue-500 text-blue-700 rounded relative" role="alert">
                <p className="font-bold">Nota sobre el Servicio del Catastro</p>
                <p className="text-sm">Esta aplicación utiliza el servicio público del Catastro. La disponibilidad y precisión de los datos dependen de dicho servicio. Este es un uso no oficial y no está afiliado al Catastro.</p>
                <button 
                    onClick={() => setShowApiWarning(false)} 
                    className="absolute top-1 right-2 text-blue-500 hover:text-blue-700 text-2xl leading-none"
                    aria-label="Cerrar advertencia"
                >
                    &times;
                </button>
            </div>
        )}

        <div className="mb-6">
          <button
            onClick={handleGetLocation}
            disabled={isGeoCatastroButtonBusy}
            className="w-full bg-cyan-500 hover:bg-cyan-600 text-white font-semibold py-3 px-4 rounded-lg shadow-md transition-colors duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-opacity-75 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-live="polite"
            aria-busy={isGeoCatastroButtonBusy}
          >
            {isGeoCatastroButtonBusy && <span className="inline-block animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-2"></span>}
            {geoCatastroButtonText}
          </button>
        </div>
        
        {renderGeoCatastroAlerts()}
        
        {catastroInfo && (catastroInfo.referenciaOriginal || (catastroInfo.message && !catastroError)) && renderCatastroData()}
        {(coordinates || utmCoordinatesForDisplay) && !locationError && renderCoordinatesData()}

      </div> 
    </div> 
  );
};

export default App;