
import React, { useState, useCallback, useEffect } from 'react';

const App: React.FC = () => {
  const [coordinates, setCoordinates] = useState<GeolocationCoordinates | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState<boolean>(false);
  const [isNonSecureContext, setIsNonSecureContext] = useState<boolean>(false);

  const [catastroInfo, setCatastroInfo] = useState<{ referencia: string | null; direccion: string | null } | null>(null);
  const [catastroError, setCatastroError] = useState<string | null>(null);
  const [isFetchingCatastroInfo, setIsFetchingCatastroInfo] = useState<boolean>(false);
  const [showApiWarning, setShowApiWarning] = useState<boolean>(false);

  useEffect(() => {
    // Mostrar advertencia si la página está en HTTP (geolocalización podría ser menos fiable)
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setIsNonSecureContext(true);
    }
    // Mostrar advertencia sobre API si la página está en HTTPS (posibles problemas de CORS)
    // ya que la API del Catastro, aunque HTTPS, podría tener restricciones de CORS.
    if (window.location.protocol === 'https:') {
      setShowApiWarning(true);
    }
  }, []);

  const fetchCatastroInfo = async (coords: GeolocationCoordinates) => {
    setIsFetchingCatastroInfo(true);
    setCatastroInfo(null);
    setCatastroError(null);

    // URL del servicio de Catastro (HTTPS)
    const catastroApiUrl = `https://ovc.catastro.mineco.es/ovcservweb/OVCServWeb.asmx/Consulta_DNPLOC_Pol?SRS=EPSG:4326&Coordenada_X=${coords.longitude}&Coordenada_Y=${coords.latitude}`;
    
    try {
      const response = await fetch(catastroApiUrl); 
      
      if (!response.ok) {
        console.error("Error en la respuesta de la red o CORS:", response.status, response.statusText);
        setCatastroError(`Error al contactar el servicio del Catastro (status: ${response.status}). Esto puede deberse a restricciones de CORS o problemas de red.`);
        setIsFetchingCatastroInfo(false);
        return;
      }

      const xmlText = await response.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "application/xml");

      const errorNode = xmlDoc.querySelector("err");
      if (errorNode) {
        const errorCode = errorNode.querySelector("cod")?.textContent;
        const errorDesc = errorNode.querySelector("des")?.textContent;
        console.warn("Error desde la API del Catastro:", errorCode, errorDesc);
        setCatastroError(`Catastro: ${errorDesc} (Código: ${errorCode})`);
        setIsFetchingCatastroInfo(false);
        return;
      }
      
      const pc1Node = xmlDoc.querySelector("pc1");
      const pc2Node = xmlDoc.querySelector("pc2");
      const ldtNode = xmlDoc.querySelector("ldt");

      const referenciaCatastral = pc1Node && pc2Node ? `${pc1Node.textContent}${pc2Node.textContent}` : null;
      const direccion = ldtNode ? ldtNode.textContent : null;

      if (referenciaCatastral || direccion) {
        setCatastroInfo({ referencia: referenciaCatastral, direccion: direccion });
      } else {
        setCatastroError("No se encontró información catastral para las coordenadas proporcionadas o la respuesta no pudo ser parseada.");
      }

    } catch (e: any) {
      console.error("Error al obtener información del Catastro:", e);
      let detailedError = e.message;
      if (e.name === 'TypeError' && e.message === 'Failed to fetch') {
          detailedError = "Fallo al realizar la solicitud. Esto podría deberse a un problema de red o un bloqueo de CORS por parte del navegador si el servicio del Catastro no permite solicitudes desde este origen.";
      }
      setCatastroError(`Error al procesar la solicitud al Catastro: ${detailedError}`);
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
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 sm:w-16 sm:h-16 text-indigo-200">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
            </svg>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">Consulta Catastral Geo</h1>
          <p className="text-indigo-200 mt-2 text-sm sm:text-base">Tu ubicación e información del Catastro.</p>
        </header>

        <main>
          {isNonSecureContext && (
            <div role="alert" className="bg-yellow-500 bg-opacity-90 text-yellow-900 p-4 rounded-md mb-6 shadow-lg text-left">
              <div className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mr-2">
                   <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <h3 className="font-semibold text-lg">Atención (Contexto HTTP):</h3>
              </div>
              <p className="mt-1 ml-8 text-sm sm:text-base">
                Estás accediendo a esta aplicación mediante HTTP. Para una detección de ubicación más fiable, se recomienda usar HTTPS. 
                Algunos navegadores podrían restringir la geolocalización en contextos no seguros.
              </p>
            </div>
          )}
          
          {showApiWarning && ( // Renombrado de showMixedContentWarning
             <div role="alert" className="bg-orange-500 bg-opacity-90 text-orange-900 p-4 rounded-md mb-6 shadow-lg text-left">
              <div className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mr-2">
                   <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <h3 className="font-semibold text-lg">Advertencia sobre API Externa:</h3>
              </div>
              <p className="mt-1 ml-8 text-sm sm:text-base">
                Esta aplicación se conecta a un servicio externo del Catastro. Si la información catastral no aparece, podría deberse a
                restricciones de red, problemas temporales con el servicio del Catastro, o políticas de seguridad de tu navegador (como CORS)
                que impidan la comunicación.
              </p>
            </div>
          )}

          <button
            onClick={handleGetLocation}
            disabled={isLoadingLocation || isFetchingCatastroInfo}
            className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-indigo-300 focus:ring-opacity-50 mb-6 text-lg"
            aria-live="polite"
          >
            {isLoadingLocation ? 'Obteniendo Ubicación...' : isFetchingCatastroInfo ? 'Consultando Catastro...' : 'Obtener Ubicación e Info Catastral'}
          </button>

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
          
          {isFetchingCatastroInfo && (
            <div className="flex items-center justify-center text-lg p-4 my-4 bg-blue-500 bg-opacity-80 rounded-md">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Consultando al Servicio del Catastro...
            </div>
          )}

          {catastroError && (
             <div role="alert" className="bg-orange-600 bg-opacity-90 text-white p-4 rounded-md mb-6 shadow-lg text-left">
              <div className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mr-2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <h3 className="font-semibold text-lg">Error de Información Catastral:</h3>
              </div>
              <p className="mt-1 ml-8 text-sm sm:text-base">{catastroError}</p>
            </div>
          )}

          {catastroInfo && !catastroError && (
            <div className="bg-teal-500 bg-opacity-90 text-white p-4 sm:p-6 rounded-md shadow-lg space-y-3 sm:space-y-4 text-left">
              <h2 className="text-xl sm:text-2xl font-semibold mb-2 sm:mb-3 text-center">Información del Catastro</h2>
              {catastroInfo.referencia && (
                <div className="bg-teal-600 bg-opacity-50 p-3 rounded-md">
                  <p className="text-xs sm:text-sm text-teal-100">Referencia Catastral:</p>
                  <p className="text-base sm:text-lg font-medium">{catastroInfo.referencia}</p>
                </div>
              )}
              {catastroInfo.direccion && (
                 <div className="bg-teal-600 bg-opacity-50 p-3 rounded-md">
                  <p className="text-xs sm:text-sm text-teal-100">Localización / Dirección:</p>
                  <p className="text-base sm:text-lg font-medium" style={{ whiteSpace: 'pre-wrap' }}>{catastroInfo.direccion}</p>
                </div>
              )}
              {!catastroInfo.referencia && !catastroInfo.direccion && (
                 <p className="text-base sm:text-lg text-center">No se pudo extraer información específica de referencia o dirección de la respuesta del Catastro.</p>
              )}
            </div>
          )}

          {!isLoadingLocation && !isFetchingCatastroInfo && !locationError && !coordinates && !isNonSecureContext && !showApiWarning && (
             <p className="text-indigo-200 text-sm sm:text-base mt-4">
              Haz clic en el botón para obtener tu ubicación e información del Catastro.
             </p>
          )}
        </main>
      </div>
      <footer className="mt-8 text-center text-indigo-300 text-xs sm:text-sm">
        <p>&copy; {new Date().getFullYear()} Consulta Catastral Geo. Datos proporcionados por la Dirección General del Catastro.</p>
      </footer>
    </div>
  );
};

export default App;
