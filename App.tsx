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

  // Estado para mostrar las coordenadas UTM de ejemplo usadas en la UI
  const [utmCoordinatesForDisplay, setUtmCoordinatesForDisplay] = useState<{x: number, y: number, srs: string} | null>(null);

  useEffect(() => {
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setIsNonSecureContext(true);
    }
    if (window.location.protocol === 'https:') {
      // Mantenemos la advertencia general sobre API externa, ya que CORS sigue siendo una posibilidad.
      setShowApiWarning(true);
    }
  }, []);

  const fetchCatastroInfo = async (geoCoords: GeolocationCoordinates | null) => {
    setIsFetchingCatastroInfo(true);
    setCatastroInfo(null);
    setCatastroError(null);
    setUtmCoordinatesForDisplay(null); // Limpiar al inicio

    let utmX: number;
    let utmY: number;
    const srs = "EPSG:25830";
    
    // --- INICIO SECCIÓN DE TRANSFORMACIÓN DE COORDENADAS (PENDIENTE) ---
    // TODO: Implementar la transformación de WGS84 (geoCoords.latitude, geoCoords.longitude) a UTM EPSG:25830 (x, y)
    // Por ahora, SIEMPRE usamos valores de ejemplo para probar la estructura de la API.
    // Esto significa que la ubicación real del usuario NO se está utilizando para la consulta al Catastro.
    utmX = 123456; // Ejemplo X UTM EPSG:25830
    utmY = 4567890; // Ejemplo Y UTM EPSG:25830
    setUtmCoordinatesForDisplay({ x: utmX, y: utmY, srs: srs });
    console.warn(`ADVERTENCIA: Usando coordenadas UTM de ejemplo (X: ${utmX}, Y: ${utmY}, SRS: ${srs}). La transformación de coordenadas reales no está implementada.`);
    // --- FIN SECCIÓN DE TRANSFORMACIÓN DE COORDENADAS ---

    const soapRequestBody = `
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cat="http://catastro.meh.es/">
   <soapenv:Header/>
   <soapenv:Body>
      <cat:Consulta_CPMRC>
         <cat:Coord>
            <cat:xc>${utmX}</cat:xc>
            <cat:yc>${utmY}</cat:yc>
            <cat:sr>${srs}</cat:sr>
         </cat:Coord>
      </cat:Consulta_CPMRC>
   </soapenv:Body>
</soapenv:Envelope>
    `.trim();

    const catastroApiUrl = `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx`;
    
    try {
      const response = await fetch(catastroApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml;charset=UTF-8',
          'SOAPAction': 'http://catastro.meh.es/Consulta_CPMRC' // A menudo requerido por servicios SOAP .asmx
        },
        body: soapRequestBody,
      });
      
      if (!response.ok) {
        console.error("Error en la respuesta de la red o CORS:", response.status, response.statusText, await response.text());
        setCatastroError(`Error al contactar el servicio del Catastro (status: ${response.status}). Esto puede deberse a restricciones de CORS, problemas de red, una solicitud SOAP mal formada o que el servicio requiera una acción SOAP específica. Endpoint: ${catastroApiUrl}`);
        setIsFetchingCatastroInfo(false);
        return;
      }

      const xmlText = await response.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "application/xml");
      
      // console.log("Respuesta XML del Catastro:", xmlText); // Para depuración

      const faultStringNode = xmlDoc.querySelector("faultstring, Fault > Reason > Text"); // SOAP 1.1 y SOAP 1.2
      if (faultStringNode) {
        const errorDesc = faultStringNode.textContent;
        console.warn("Error SOAP desde la API del Catastro:", errorDesc);
        setCatastroError(`Catastro (SOAP Fault): ${errorDesc}`);
        setIsFetchingCatastroInfo(false);
        return;
      }
      
      // Intentar encontrar el nodo resultado. Los namespaces pueden complicar esto.
      // <Consulta_CPMRCResponse xmlns="http://catastro.meh.es/"> <Consulta_CPMRCResult>...</Consulta_CPMRCResult> </Consulta_CPMRCResponse>
      // A menudo, el contenido útil no tiene prefijo dentro del nodo resultado si este define un xmlns.
      const resultNode = xmlDoc.querySelector("Consulta_CPMRCResult"); // Busca sin namespace primero

      if (!resultNode) {
        setCatastroError("No se pudo encontrar el nodo 'Consulta_CPMRCResult' en la respuesta XML. La estructura de la respuesta puede haber cambiado o ser inesperada.");
        console.log("Respuesta XML completa (para depuración de estructura):", xmlText);
        setIsFetchingCatastroInfo(false);
        return;
      }

      const errorCodNode = resultNode.querySelector("control > cuerr > cod"); 
      const errorDesNode = resultNode.querySelector("control > cuerr > des");

      if (errorCodNode && errorCodNode.textContent !== "0") {
        const errorCode = errorCodNode.textContent;
        const errorDesc = errorDesNode?.textContent || "Error desconocido del Catastro";
        console.warn("Error funcional desde la API del Catastro:", errorCode, errorDesc);
        setCatastroError(`Catastro: ${errorDesc} (Código: ${errorCode})`);
        setIsFetchingCatastroInfo(false);
        return;
      }
      
      let referenciaCatastral: string | null = null;
      let direccion: string | null = null;

      const coorNode = resultNode.querySelector("coor"); // Nodo principal con datos de coordenadas y parcela
      if (coorNode) {
        const pc1Node = coorNode.querySelector("pc > pc1");
        const pc2Node = coorNode.querySelector("pc > pc2");
        if (pc1Node?.textContent && pc2Node?.textContent) {
            referenciaCatastral = `${pc1Node.textContent}${pc2Node.textContent}`;
        }

        const dtNode = coorNode.querySelector("dt"); // Datos territoriales (dirección)
        if (dtNode) {
            const tv = dtNode.querySelector("tv")?.textContent || ""; // Tipo vía
            const nv = dtNode.querySelector("nv")?.textContent || ""; // Nombre vía
            const pnp = dtNode.querySelector("pnp")?.textContent || ""; // Primer número policía
            const snp = dtNode.querySelector("snp")?.textContent || ""; // Segundo número policía (e.g. BIS)
            const km = dtNode.querySelector("km")?.textContent || ""; // Kilómetro
            
            const bq = dtNode.querySelector("bq")?.textContent || ""; // Bloque
            const es = dtNode.querySelector("es")?.textContent || ""; // Escalera
            const pt = dtNode.querySelector("pt")?.textContent || ""; // Planta
            const pu = dtNode.querySelector("pu")?.textContent || ""; // Puerta

            const loc = dtNode.querySelector("loc")?.textContent || ""; // Localización (municipio)
            const cp = dtNode.querySelector("cp")?.textContent || ""; // Código Postal (a veces presente)

            let dirParts = [];
            if (tv && nv) dirParts.push(`${tv} ${nv}`);
            if (pnp) dirParts.push(`Nº ${pnp}${snp ? ' ' + snp : ''}`);
            if (km) dirParts.push(`Km ${km}`);
            if (bq) dirParts.push(`Bl. ${bq}`);
            if (es) dirParts.push(`Esc. ${es}`);
            if (pt) dirParts.push(`Pl. ${pt}`);
            if (pu) dirParts.push(`Pta. ${pu}`);
            if (cp && loc) dirParts.push(`${cp} ${loc}`);
            else if (loc) dirParts.push(loc);
            
            if (dirParts.length > 0) {
                direccion = dirParts.join(', ');
            }
        }
      }


      if (referenciaCatastral || direccion) {
        setCatastroInfo({ referencia: referenciaCatastral, direccion: direccion });
      } else {
        // Si después de todos los intentos no se encuentra nada, y no hubo error de API previo
        if (!(errorCodNode && errorCodNode.textContent !== "0")) {
            setCatastroError("No se encontró información catastral específica (referencia o dirección) para las coordenadas o la respuesta no pudo ser parseada. Verifique la consola para la respuesta XML completa.");
            console.log("Respuesta XML del Catastro (para depuración):", xmlText);
        }
      }

    } catch (e: any) {
      console.error("Error al obtener información del Catastro:", e);
      let detailedError = e.message;
      if (e.name === 'TypeError' && e.message === 'Failed to fetch') {
          detailedError = "Fallo al realizar la solicitud. Esto podría deberse a un problema de red, un bloqueo de CORS por parte del navegador, o que el endpoint no esté disponible.";
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
    setUtmCoordinatesForDisplay(null); // Limpiar advertencia de UTM de ejemplo

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoordinates(position.coords);
        setIsLoadingLocation(false);
        fetchCatastroInfo(position.coords); // Pasar las coordenadas geográficas
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
  }, []); // fetchCatastroInfo no necesita estar en dependencias si no usa estado que cambie fuera de su scope directo

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
                Estás accediendo a esta aplicación mediante HTTP. Para una detección de ubicación más fiable, se recomienda usar HTTPS. 
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
                <h3 className="font-semibold text-lg">Advertencia sobre API Externa:</h3>
              </div>
              <p className="mt-1 ml-8 text-sm sm:text-base">
                Esta aplicación se conecta a un servicio externo del Catastro. Si la información catastral no aparece, podría deberse a
                restricciones de red (CORS), problemas temporales con el servicio del Catastro, o que las coordenadas de ejemplo no devuelvan datos.
              </p>
            </div>
          )}

          {utmCoordinatesForDisplay && (
            <div role="alert" className="bg-amber-600 bg-opacity-90 text-white p-4 rounded-md mb-6 shadow-lg text-left">
              <div className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mr-2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <h3 className="font-semibold text-lg">Nota Importante (Desarrollo):</h3>
              </div>
              <p className="mt-1 ml-8 text-sm sm:text-base">
                Actualmente, la consulta al Catastro utiliza <strong>coordenadas UTM de ejemplo</strong> (X: {utmCoordinatesForDisplay.x}, Y: {utmCoordinatesForDisplay.y}, SRS: {utmCoordinatesForDisplay.srs})
                en lugar de tu ubicación real. La transformación de coordenadas Lat/Lon a UTM EPSG:25830 está pendiente.
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
              Consultando al Servicio del Catastro...
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
        <p className="mt-1">La transformación de coordenadas geográficas a UTM es un paso pendiente.</p>
      </footer>
    </div>
  );
};

export default App;
