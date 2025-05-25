
import React, { useState, useCallback, useEffect } from 'react';

interface CatastralInfo {
  referencia: string;
  direccion: string;
}

const App: React.FC = () => {
  const [coordinates, setCoordinates] = useState<GeolocationCoordinates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState<boolean>(false);
  const [isNonSecureContext, setIsNonSecureContext] = useState<boolean>(false);

  const [catastralInfo, setCatastralInfo] = useState<CatastralInfo | null>(null);
  const [catastralError, setCatastralError] = useState<string | null>(null);
  const [isFetchingCatastro, setIsFetchingCatastro] = useState<boolean>(false);

  useEffect(() => {
    if (
      window.location.protocol !== 'https:' &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1'
    ) {
      setIsNonSecureContext(true);
    }
  }, []);

  const fetchCatastralData = async (coords: GeolocationCoordinates) => {
    setIsFetchingCatastro(true);
    setCatastralInfo(null);
    setCatastralError(null);

    const url = `https://ovc.catastro.meh.es/OVCServWeb/OVCCallejero_WCF/ovccallejerocpsg.asmx/Consulta_DNPLOC_Codigos?SRS=EPSG:4326&Coordenada_X=${coords.longitude}&Coordenada_Y=${coords.latitude}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Error HTTP del Catastro: ${response.status} ${response.statusText}`);
      }
      const xmlText = await response.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "application/xml");

      const errorNode = xmlDoc.querySelector("control > cuerr");
      const errorCode = errorNode?.textContent;

      if (errorCode !== "0") {
        const errorDescNode = xmlDoc.querySelector("control > des");
        const errorDesc = errorDescNode?.textContent || "Error desconocido del Catastro.";
        console.error("Error del Catastro XML:", errorCode, errorDesc);
        setCatastralError(`No se pudo obtener información catastral (${errorCode}): ${errorDesc}`);
        setIsFetchingCatastro(false);
        return;
      }
      
      const pc1Node = xmlDoc.querySelector("rcdnp > rc > pc1");
      const pc2Node = xmlDoc.querySelector("rcdnp > rc > pc2");
      const carNode = xmlDoc.querySelector("rcdnp > rc > car");
      const cc1Node = xmlDoc.querySelector("rcdnp > rc > cc1");
      const cc2Node = xmlDoc.querySelector("rcdnp > rc > cc2");
      
      const ldtNode = xmlDoc.querySelector("rcdnp > ldt");

      const pc1 = pc1Node?.textContent || "";
      const pc2 = pc2Node?.textContent || "";
      const car = carNode?.textContent || "";
      const cc1 = cc1Node?.textContent || "";
      const cc2 = cc2Node?.textContent || "";

      // La referencia catastral completa se forma concatenando estas partes
      // A veces algunas partes pueden estar vacías o no ser relevantes, 
      // pero para una referencia completa de urbana suelen ser 14 caracteres (pc1+pc2) + 6 de parcela/inmueble.
      // Nos aseguramos de que no haya espacios extra.
      const referenciaCompleta = (`${pc1}${pc2}${car}${cc1}${cc2}`).replace(/\s+/g, '');
      const direccion = ldtNode?.textContent || "No disponible";
      
      if (referenciaCompleta && referenciaCompleta.length >= 14) { // Longitud mínima de referencia catastral urbana/rústica
        setCatastralInfo({ referencia: referenciaCompleta, direccion });
      } else {
        setCatastralError("No se encontró información catastral para estas coordenadas o la referencia es incompleta.");
      }

    } catch (e: any) {
      console.error("Error al obtener datos catastrales:", e);
      setCatastralError(`Error al contactar el servicio del Catastro: ${e.message}. Es posible que el servicio no esté disponible o haya problemas de CORS.`);
    } finally {
      setIsFetchingCatastro(false);
    }
  };

  const handleGetLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError("La geolocalización no es compatible con tu navegador.");
      setIsLoadingLocation(false);
      return;
    }

    setIsLoadingLocation(true);
    setError(null);
    setCoordinates(null);
    setCatastralInfo(null);
    setCatastralError(null);


    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoordinates(position.coords);
        setIsLoadingLocation(false);
        fetchCatastralData(position.coords); // Llamar a la API del Catastro
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
        setError(errorMessage);
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
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">Detector de Coordenadas</h1>
          <p className="text-indigo-200 mt-2 text-sm sm:text-base">Obtén tus coordenadas y datos catastrales.</p>
        </header>

        <main>
          {isNonSecureContext && !error && (
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
            disabled={isLoadingLocation || isFetchingCatastro}
            className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-400 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-indigo-300 focus:ring-opacity-50 mb-6 text-lg"
            aria-live="polite"
          >
            {isLoadingLocation ? 'Obteniendo Ubicación...' : isFetchingCatastro ? 'Obteniendo Datos Catastrales...' : 'Obtener Mi Ubicación y Datos Catastrales'}
          </button>

          {error && (
            <div role="alert" className="bg-red-500 bg-opacity-90 text-white p-4 rounded-md mb-6 shadow-lg text-left">
              <div className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mr-2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <h3 className="font-semibold text-lg">Error de Ubicación:</h3>
              </div>
              <p className="mt-1 ml-8 text-sm sm:text-base">{error}</p>
            </div>
          )}

          {coordinates && !error && (
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
          
          {isFetchingCatastro && (
            <div className="flex items-center justify-center text-lg p-4 my-4 bg-blue-500 bg-opacity-80 rounded-md">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Buscando información catastral...
            </div>
          )}

          {catastralError && (
             <div role="alert" className="bg-orange-500 bg-opacity-90 text-white p-4 rounded-md mb-6 shadow-lg text-left">
              <div className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mr-2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <h3 className="font-semibold text-lg">Error Catastral:</h3>
              </div>
              <p className="mt-1 ml-8 text-sm sm:text-base">{catastralError}</p>
            </div>
          )}

          {catastralInfo && !catastralError && (
            <div className="bg-teal-500 bg-opacity-90 text-white p-4 sm:p-6 rounded-md shadow-lg space-y-2 sm:space-y-3 text-left">
              <h2 className="text-xl sm:text-2xl font-semibold mb-2 sm:mb-3 text-center">Información Catastral</h2>
              <div className="bg-teal-600 bg-opacity-50 p-3 rounded-md">
                <p className="text-xs sm:text-sm text-teal-100">Referencia Catastral:</p>
                <p className="text-lg sm:text-xl font-medium break-all">{catastralInfo.referencia}</p>
              </div>
              <div className="bg-teal-600 bg-opacity-50 p-3 rounded-md">
                <p className="text-xs sm:text-sm text-teal-100">Dirección (según Catastro):</p>
                <p className="text-base sm:text-lg font-medium">{catastralInfo.direccion}</p>
              </div>
            </div>
          )}

          {!isLoadingLocation && !isFetchingCatastro && !error && !coordinates && !isNonSecureContext && (
             <p className="text-indigo-200 text-sm sm:text-base mt-4">Haz clic en el botón para mostrar tus coordenadas e información catastral.</p>
          )}
        </main>
      </div>
      <footer className="mt-8 text-center text-indigo-300 text-xs sm:text-sm">
        <p>&copy; {new Date().getFullYear()} Detector de Coordenadas. Creado con ❤️.</p>
      </footer>
    </div>
  );
};

export default App;

