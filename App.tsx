
import React, { useState, useCallback, useEffect } from 'react';

const App: React.FC = () => {
  const [coordinates, setCoordinates] = useState<GeolocationCoordinates | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState<boolean>(false);
  const [isNonSecureContext, setIsNonSecureContext] = useState<boolean>(false);

  const [catastroInfo, setCatastroInfo] = useState<{ referencia: string | null; direccion: string | null } | null>(null);
  const [catastroError, setCatastroError] = useState<string | null>(null);
  const [isFetchingCatastroInfo, setIsFetchingCatastroInfo] = useState<boolean>(false);
  const [showApiWarning, setShowApiWarning] = useState<boolean>(true);

  const [utmCoordinatesForDisplay, setUtmCoordinatesForDisplay] = useState<{x: number, y: number, srs: string} | null>(null);

  useEffect(() => {
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setIsNonSecureContext(true);
    }
  }, []);

  const fetchCatastroInfo = async (geoCoords: GeolocationCoordinates | null) => {
    setIsFetchingCatastroInfo(true);
    setCatastroInfo(null);
    setCatastroError(null);
    setUtmCoordinatesForDisplay(null); 

    let utmX: number;
    let utmY: number;
    const srs = "EPSG:25830"; // Example SRS, should match what the API expects if not transformed
    
    // Using example UTM coordinates as transformation from WGS84 is not implemented
    utmX = 123456; 
    utmY = 4567890; 
    setUtmCoordinatesForDisplay({ x: utmX, y: utmY, srs: srs });
    console.warn(`ADVERTENCIA: Usando coordenadas UTM de ejemplo (X: ${utmX}, Y: ${utmY}, SRS: ${srs}). La transformación de coordenadas WGS84 a UTM EPSG:25830 no está implementada.`);
    
    const proxyApiUrl = `/api/catastro-proxy`;
    
    try {
      const response = await fetch(proxyApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ utmX, utmY, srs }),
      });
      
      // Expecting JSON response from our proxy (which gets JSON from WCF service)
      const jsonData = await response.json();

      if (!response.ok) {
        // Error details should be in jsonData.details or jsonData.error from our proxy
        const errorDetails = jsonData.details || jsonData.error || JSON.stringify(jsonData);
        console.error("Error desde el proxy o Catastro (JSON):", response.status, errorDetails);
        setCatastroError(`Error al contactar el servicio (status: ${response.status}). Detalles: ${errorDetails}. Endpoint: ${proxyApiUrl}`);
        setIsFetchingCatastroInfo(false);
        return;
      }

      // Process the JSON data
      const result = jsonData.Consulta_RCCOORResult;

      if (!result) {
        setCatastroError("No se encontró 'Consulta_RCCOORResult' en la respuesta JSON. La estructura puede haber cambiado.");
        console.log("JSON completo (para depuración de estructura):", JSON.stringify(jsonData, null, 2));
        setIsFetchingCatastroInfo(false);
        return;
      }
      
      // Check for functional errors from Catastro within the JSON structure
      // Example: result.control.cuerr should be 0 for success
      // The exact structure for cuerr and des might be nested, e.g., result.control.cuerr or result.control.lerr.err[0].des
      // Based on the example `{"control": { "cucoor": 1, "cuerr": 0 }}`
      const control = result.control;
      if (control && typeof control.cuerr === 'number' && control.cuerr !== 0) {
        // Attempt to find a descriptive error message
        let errorDesc = "Error desconocido del Catastro";
        if (result.lerr && Array.isArray(result.lerr.err) && result.lerr.err.length > 0 && result.lerr.err[0].des) {
            errorDesc = result.lerr.err[0].des;
        } else if (control.des) { // Some services might put 'des' directly in control
            errorDesc = control.des;
        }
        console.warn("Error funcional desde la API del Catastro (JSON):", control.cuerr, errorDesc);
        setCatastroError(`Catastro: ${errorDesc} (Código: ${control.cuerr})`);
        setIsFetchingCatastroInfo(false);
        return;
      }
      
      let referenciaCatastral: string | null = null;
      let direccion: string | null = null;

      // Extract data from the 'coordenadas' object
      // The WCF JSON example shows `{"coordenadas": { /* ... */ }}`
      // And inside that, `coord` could be an object or an array if multiple results are possible
      const coordData = result.coordenadas?.coord;
      
      if (coordData) {
        // If coordData is an array, take the first element, otherwise use it directly
        const actualCoord = Array.isArray(coordData) ? coordData[0] : coordData;

        if (actualCoord?.pc?.pc1 && actualCoord?.pc?.pc2) {
            referenciaCatastral = `${actualCoord.pc.pc1}${actualCoord.pc.pc2}`;
        }

        if (actualCoord?.ldt) { // ldt usually contains the full formatted address
            direccion = actualCoord.ldt.trim();
        }
        // Add more specific address component extraction if needed from actualCoord.dt or similar,
        // if ldt is not sufficient or always present.
      }

      if (referenciaCatastral || direccion) {
        setCatastroInfo({ referencia: referenciaCatastral, direccion: direccion });
      } else {
         // Only set error if no functional error was already caught
        if (!(control && typeof control.cuerr === 'number' && control.cuerr !== 0)) {
            setCatastroError("No se encontró información catastral específica (referencia o dirección) en la respuesta JSON.");
            console.log("JSON del Catastro (vía proxy, para depuración):", JSON.stringify(jsonData, null, 2));
        }
      }

    } catch (e: any) {
      console.error("Error al procesar la solicitud al proxy del Catastro (JSON):", e);
      // Check if 'e' is from response.json() failing due to non-JSON response
      if (e instanceof SyntaxError && e.message.toLowerCase().includes('json')) {
        setCatastroError(`Error: La respuesta del proxy no fue JSON válido. ${e.message}`);
      } else {
        setCatastroError(`Error al procesar la solicitud al proxy: ${e.message}`);
      }
    } finally {
      setIsFetchingCatastroInfo(false);
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
    setCatastroInfo(null);
    setCatastroError(null);
    setUtmCoordinatesForDisplay(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoordinates(position.coords);
        setIsLoadingLocation(false);
        fetchCatastroInfo(position.coords); 
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
  }, []); 

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-600 to-indigo-700 flex flex-col items-center justify-center p-4 sm:p-6 text-white font-sans antialiased">
      <div className="bg-white bg-opacity-25 backdrop-blur-lg shadow-2xl rounded-xl p-6 sm:p-8 max-w-lg w-full text-center transform transition-all duration-500 hover:scale-105">
        <header className="mb-6 sm:mb-8">
          <div className="flex justify-center items-center mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 sm:w-16 sm:h-16 text-indigo-200" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
            </svg>
          </div>
          <h1 id="main-title" className="text-3xl sm:text-4xl font-bold tracking-tight text-white">Consulta Catastral Geo</h1>
          <p className="text-indigo-200 mt-2 text-sm sm:text-base">Tu ubicación e información del Catastro.</p>
        </header>

        <main>
          {isNonSecureContext && (
            <div role="alert" className="bg-yellow-500 bg-opacity-90 text-yellow-900 p-4 rounded-md mb-6 shadow-lg text-left">
              <div className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mr-2" aria-hidden="true">
                   <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <h3 className="font-semibold text-lg">Atención (Contexto HTTP):</h3>
              </div>
              <p className="mt-1 ml-8 text-sm sm:text-base">
                Estás accediendo a esta aplicación mediante HTTP. Para una detección de ubicación más fiable y segura, se recomienda usar HTTPS. 
                Algunos navegadores podrían restringir la geolocalización en contextos no seguros.
              </p>
            </div>
          )}
          
          {showApiWarning && ( 
             <div role="alert" className="bg-orange-500 bg-opacity-90 text-orange-900 p-4 rounded-md mb-6 shadow-lg text-left">
              <div className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mr-2" aria-hidden="true">
                   <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <h3 className="font-semibold text-lg">Sobre la API del Catastro:</h3>
              </div>
              <p className="mt-1 ml-8 text-sm sm:text-base">
                Esta aplicación se conecta a un servicio del Catastro a través de un proxy. La obtención de datos puede fallar debido a:
              </p>
              <ul className="list-disc list-inside mt-1 ml-8 text-sm sm:text-base">
                <li><strong>Problemas de red o del servicio del Catastro:</strong> El servicio podría estar temporalmente inaccesible.</li>
                <li><strong>Coordenadas:</strong> El servicio actual espera coordenadas UTM (EPSG:25830). La conversión desde Lat/Lon está pendiente (ver nota abajo).</li>
                <li><strong>Errores del proxy:</strong> Si el proxy intermedio falla.</li>
              </ul>
            </div>
          )}

          {utmCoordinatesForDisplay && (
            <div role="alert" className="bg-amber-600 bg-opacity-90 text-white p-4 rounded-md mb-6 shadow-lg text-left">
              <div className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mr-2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <h3 className="font-semibold text-lg">Nota Importante (Coordenadas):</h3>
              </div>
              <p className="mt-1 ml-8 text-sm sm:text-base">
                La consulta al Catastro utiliza <strong>coordenadas UTM de ejemplo</strong> (X: {utmCoordinatesForDisplay.x}, Y: {utmCoordinatesForDisplay.y}, SRS: {utmCoordinatesForDisplay.srs})
                en lugar de tu ubicación real. La transformación de coordenadas geográficas (WGS84) a UTM (EPSG:25830) es un paso técnico pendiente.
                Los resultados mostrados corresponden a estas coordenadas de prueba.
              </p>
            </div>
          )}


          <button
            onClick={handleGetLocation}
            disabled={isLoadingLocation || isFetchingCatastroInfo}
            className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-indigo-300 focus:ring-opacity-50 mb-6 text-lg"
            aria-live="polite"
            aria-label="Obtener Ubicación e Información Catastral"
          >
            {isLoadingLocation ? 'Obteniendo Ubicación...' : isFetchingCatastroInfo ? 'Consultando Catastro...' : 'Obtener Ubicación e Info Catastral'}
          </button>

          {locationError && (
            <div role="alert" aria-atomic="true" className="bg-red-500 bg-opacity-90 text-white p-4 rounded-md mb-6 shadow-lg text-left">
              <div className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mr-2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <h3 className="font-semibold text-lg">Error de Ubicación:</h3>
              </div>
              <p className="mt-1 ml-8 text-sm sm:text-base">{locationError}</p>
            </div>
          )}

          {coordinates && !locationError && (
            <div aria-live="polite" className="bg-green-500 bg-opacity-90 text-white p-4 sm:p-6 rounded-md shadow-lg space-y-2 sm:space-y-3 text-left mb-6">
              <h2 className="text-xl sm:text-2xl font-semibold mb-2 sm:mb-3 text-center">¡Ubicación WGS84 Encontrada!</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4">
                <div className="bg-green-600 bg-opacity-50 p-3 rounded-md">
                  <p className="text-xs sm:text-sm text-green-100" id="lat-label">Latitud:</p>
                  <p className="text-lg sm:text-xl font-medium" aria-labelledby="lat-label">{coordinates.latitude.toFixed(6)}</p>
                </div>
                <div className="bg-green-600 bg-opacity-50 p-3 rounded-md">
                  <p className="text-xs sm:text-sm text-green-100" id="lon-label">Longitud:</p>
                  <p className="text-lg sm:text-xl font-medium" aria-labelledby="lon-label">{coordinates.longitude.toFixed(6)}</p>
                </div>
              </div>
              {coordinates.accuracy && (
                <div className="bg-green-600 bg-opacity-50 p-3 rounded-md mt-2 sm:mt-3">
                  <p className="text-xs sm:text-sm text-green-100" id="acc-label">Precisión:</p> 
                  <p className="text-base sm:text-lg font-medium" aria-labelledby="acc-label">{coordinates.accuracy.toFixed(2)} metros</p>
                </div>
              )}
            </div>
          )}
          
          {isFetchingCatastroInfo && (
            <div role="status" aria-live="polite" className="flex items-center justify-center text-lg p-4 my-4 bg-blue-500 bg-opacity-80 rounded-md">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Consultando al Servicio del Catastro (vía proxy)...
            </div>
          )}

          {catastroError && (
             <div role="alert" aria-atomic="true" className="bg-orange-600 bg-opacity-90 text-white p-4 rounded-md mb-6 shadow-lg text-left">
              <div className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mr-2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <h3 className="font-semibold text-lg">Error de Información Catastral:</h3>
              </div>
              <p className="mt-1 ml-8 text-sm sm:text-base">{catastroError}</p>
            </div>
          )}

          {catastroInfo && !catastroError && (
            <div aria-live="polite" className="bg-teal-500 bg-opacity-90 text-white p-4 sm:p-6 rounded-md shadow-lg space-y-3 sm:space-y-4 text-left">
              <h2 className="text-xl sm:text-2xl font-semibold mb-2 sm:mb-3 text-center">Información del Catastro</h2>
              {catastroInfo.referencia && (
                <div className="bg-teal-600 bg-opacity-50 p-3 rounded-md">
                  <p className="text-xs sm:text-sm text-teal-100" id="ref-cat-label">Referencia Catastral:</p>
                  <p className="text-base sm:text-lg font-medium" aria-labelledby="ref-cat-label">{catastroInfo.referencia}</p>
                </div>
              )}
              {catastroInfo.direccion && (
                 <div className="bg-teal-600 bg-opacity-50 p-3 rounded-md">
                  <p className="text-xs sm:text-sm text-teal-100" id="dir-cat-label">Localización / Dirección:</p>
                  <p className="text-base sm:text-lg font-medium" style={{ whiteSpace: 'pre-wrap' }} aria-labelledby="dir-cat-label">{catastroInfo.direccion}</p>
                </div>
              )}
              {!catastroInfo.referencia && !catastroInfo.direccion && (
                 <p className="text-base sm:text-lg text-center">No se pudo extraer información específica de referencia o dirección de la respuesta del Catastro.</p>
              )}
            </div>
          )}

          {!isLoadingLocation && !isFetchingCatastroInfo && !locationError && !coordinates && !isNonSecureContext && !showApiWarning && !utmCoordinatesForDisplay && (
             <p className="text-indigo-200 text-sm sm:text-base mt-4">
              Haz clic en el botón para obtener tu ubicación e información del Catastro.
             </p>
          )}
        </main>
      </div>
      <footer className="mt-8 text-center text-indigo-300 text-xs sm:text-sm">
        <p>&copy; {new Date().getFullYear()} Consulta Catastral Geo. Datos proporcionados por la Dirección General del Catastro.</p>
        <p className="mt-1">Esta aplicación utiliza un proxy para acceder a los servicios del Catastro y aún enfrenta desafíos como la conversión de coordenadas (Lat/Lon a UTM).</p>
      </footer>
    </div>
  );
};

export default App;
