
import React, { useState, useCallback, useEffect } from 'react';
import proj4 from 'proj4';

// Define EPSG:25830 (ETRS89 / UTM zone 30N) for Spain - Kept for reference if needed elsewhere, but not used for Catastro API now.
proj4.defs(
  'EPSG:25830',
  '+proj=utm +zone=30 +ellps=GRS80 +units=m +no_defs +type=crs'
);

// Define EPSG:23030 (ED50 / UTM zone 30N) as required by the Catastro service
proj4.defs(
  'EPSG:23030',
  '+proj=utm +zone=30 +ellps=intl +units=m +no_defs +towgs84=-87,-98,-121,0,0,0,0' // Used standard 7-param towgs84 for ED50
);
// EPSG:4326 (WGS84) is typically predefined in proj4


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

  const fetchCatastroInfo = useCallback(async (geoCoords: GeolocationCoordinates | null) => {
    setIsFetchingCatastroInfo(true);
    setCatastroInfo(null);
    setCatastroError(null);
    setUtmCoordinatesForDisplay(null); 

    if (!geoCoords) {
        setCatastroError("No se proporcionaron coordenadas geográficas para la consulta.");
        setIsFetchingCatastroInfo(false);
        return;
    }

    let utmX: number;
    let utmY: number;
    const srsForCatastro = "EPSG:23030"; // Use EPSG:23030 for Catastro
    
    try {
      // Convert WGS84 (EPSG:4326) to ED50 / UTM zone 30N (EPSG:23030)
      const wgs84 = 'EPSG:4326'; // Source CRS from navigator.geolocation
      const targetSrs = srsForCatastro; // Target CRS for Catastro

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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ utmX, utmY, srs: srsForCatastro }),
      });
      
      const jsonData = await response.json();

      if (!response.ok) {
        const errorDetails = jsonData.details || jsonData.error || JSON.stringify(jsonData);
        console.error("Error desde el proxy o Catastro (JSON):", response.status, errorDetails);
        setCatastroError(`Error al contactar el servicio (status: ${response.status}). Detalles: ${errorDetails}. Endpoint: ${proxyApiUrl}`);
        setIsFetchingCatastroInfo(false);
        return;
      }

      const result = jsonData.Consulta_RCCOORResult;

      if (!result) {
        setCatastroError("No se encontró 'Consulta_RCCOORResult' en la respuesta JSON. La estructura puede haber cambiado.");
        console.log("JSON completo (para depuración de estructura, no se encontró Consulta_RCCOORResult):", JSON.stringify(jsonData, null, 2));
        setIsFetchingCatastroInfo(false);
        return;
      }
      
      const control = result.control;

      // Log the full jsonData if errors are indicated by control.cuerr, for easier debugging of error structure
      if (control && typeof control.cuerr === 'number' && control.cuerr > 0) {
        console.log("Respuesta completa del Catastro (con control.cuerr > 0):", JSON.stringify(jsonData, null, 2));
      }
      
      // Check if control exists and cuerr is a number indicating one or more errors
      if (control && typeof control.cuerr === 'number' && control.cuerr > 0) {
        // Try to find the error container, checking for common variations like lerr or lErr
        const errorContainer = result.lerr ?? result.lErr;

        const errorsFromApi = errorContainer?.err
          ? (Array.isArray(errorContainer.err) ? errorContainer.err : [errorContainer.err])
          : [];

        let finalErrorMessage: string;

        if (errorsFromApi.length > 0) {
          const firstApiError = errorsFromApi[0];
          const errorCode = firstApiError?.cod; 
          const errorDesc = firstApiError?.des;

          const errorCodeToDisplay = (errorCode === null || errorCode === undefined)
            ? "No especificado"
            : String(errorCode);

          const errorMsgToDisplay = (typeof errorDesc === 'string' && errorDesc.trim() !== '')
            ? errorDesc.trim()
            : "Sin descripción detallada por el Catastro.";

          finalErrorMessage = `Catastro: ${errorMsgToDisplay} (Código: ${errorCodeToDisplay})`;
          
          console.warn(
            "Error funcional Catastro (con detalles de errorContainer.err):",
            `control.cuerr: ${control.cuerr}, control.cucoor: ${control.cucoor}.`,
            `Primer error interpretado: cod='${errorCodeToDisplay}', des='${errorMsgToDisplay}'.`,
            "Error container:", errorContainer ? JSON.stringify(errorContainer, null, 2) : "No presente"
          );

        } else {
          // Fallback if control.cuerr > 0 but no specific errors found in errorContainer.err
          // Use the fallback suggested by the user.
          finalErrorMessage = `Catastro: Error desconocido del Catastro (Código: ${control.cuerr})`;
          console.warn(
              "Error funcional Catastro (sin detalles en errorContainer.err o errorContainer no presente, usando fallback):",
              `control.cuerr: ${control.cuerr}, control.cucoor: ${control.cucoor}.`,
              `control.des: '${control.des || 'No disponible'}'.`,
              "Error container:", errorContainer ? JSON.stringify(errorContainer, null, 2) : "No presente",
              "Mensaje generado:", finalErrorMessage
          );
        }
        setCatastroError(finalErrorMessage);
        setIsFetchingCatastroInfo(false);
        return;
      }
      
      // If control.cuerr is 0 or not present, proceed to parse data
      let referenciaCatastral: string | null = null;
      let direccion: string | null = null;
      const coordData = result.coordenadas?.coord;
      
      if (coordData) {
        const actualCoord = Array.isArray(coordData) ? coordData[0] : coordData;
        if (actualCoord?.pc?.pc1 && actualCoord?.pc?.pc2) {
            referenciaCatastral = `${actualCoord.pc.pc1}${actualCoord.pc.pc2}`;
        }
        if (actualCoord?.ldt) { 
            direccion = actualCoord.ldt.trim();
        }
      }

      if (referenciaCatastral || direccion) {
        setCatastroInfo({ referencia: referenciaCatastral, direccion: direccion });
      } else {
        setCatastroError("No se encontró información catastral específica (referencia o dirección) para la ubicación, aunque la consulta al Catastro fue exitosa (sin errores funcionales).");
        console.log("Respuesta del Catastro (sin errores funcionales, pero sin datos específicos):", JSON.stringify(jsonData, null, 2));
      }

    } catch (e: any) {
      console.error("Error al procesar la solicitud al proxy del Catastro (JSON):", e);
      if (e instanceof SyntaxError && e.message.toLowerCase().includes('json')) {
        setCatastroError(`Error: La respuesta del proxy no fue JSON válido. ${e.message}`);
      } else {
        setCatastroError(`Error al procesar la solicitud al proxy: ${e.message}`);
      }
    } finally {
      setIsFetchingCatastroInfo(false);
    }
  }, []); 

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
  }, [fetchCatastroInfo]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-600 to-indigo-700 flex flex-col items-center justify-center p-4 sm:p-6 text-white font-sans antialiased">
      <div className="bg-white bg-opacity-25 backdrop-blur-lg shadow-2xl rounded-xl p-6 sm:p-8 max-w-lg w-full text-slate-800">
        <header className="mb-6 text-center">
          <h1 className="text-4xl font-bold text-slate-700">GeoCatastro</h1>
          <p className="text-sm text-slate-600 mt-1">Consulta la información catastral de tu ubicación</p>
        </header>

        {isNonSecureContext && (
          <div className="mb-4 p-3 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 rounded" role="alert">
            <p className="font-bold">Atención: Contexto no seguro</p>
            <p className="text-sm">La geolocalización podría no funcionar correctamente o estar desactivada. Para una funcionalidad completa, accede a esta aplicación a través de HTTPS.</p>
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
            disabled={isLoadingLocation || isFetchingCatastroInfo}
            className="w-full bg-cyan-500 hover:bg-cyan-600 text-white font-semibold py-3 px-4 rounded-lg shadow-md transition-colors duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-opacity-75 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-live="polite"
            aria-busy={isLoadingLocation || isFetchingCatastroInfo}
          >
            {isLoadingLocation ? 'Obteniendo Ubicación...' : isFetchingCatastroInfo ? 'Consultando Catastro...' : 'Obtener Ubicación y Datos Catastrales'}
          </button>
        </div>

        {locationError && (
          <div className="mb-4 p-3 bg-red-100 border-l-4 border-red-500 text-red-700 rounded" role="alert">
            <p className="font-bold">Error de Geolocalización</p>
            <p>{locationError}</p>
          </div>
        )}

        {catastroError && (
          <div className="mb-4 p-3 bg-red-100 border-l-4 border-red-500 text-red-700 rounded" role="alert">
            <p className="font-bold">Error de Información Catastral</p>
            <p>{catastroError}</p>
          </div>
        )}

        {coordinates && !locationError && (
          <div className="mb-4 p-4 bg-white rounded-lg shadow-lg">
            <h3 className="text-lg font-semibold text-slate-700 mb-2">Coordenadas Geográficas (WGS84)</h3>
            <p className="text-sm text-slate-600"><strong>Latitud:</strong> {coordinates.latitude.toFixed(6)}</p>
            <p className="text-sm text-slate-600"><strong>Longitud:</strong> {coordinates.longitude.toFixed(6)}</p>
            {coordinates.accuracy && <p className="text-sm text-slate-600"><strong>Precisión:</strong> {coordinates.accuracy.toFixed(1)} metros</p>}
          </div>
        )}

        {utmCoordinatesForDisplay && !catastroError && (
            <div className="mb-4 p-4 bg-white rounded-lg shadow-lg">
                <h3 className="text-lg font-semibold text-slate-700 mb-2">Coordenadas UTM ({utmCoordinatesForDisplay.srs})</h3>
                <p className="text-sm text-slate-600"><strong>X:</strong> {utmCoordinatesForDisplay.x.toLocaleString()}</p>
                <p className="text-sm text-slate-600"><strong>Y:</strong> {utmCoordinatesForDisplay.y.toLocaleString()}</p>
            </div>
        )}
        
        {catastroInfo && (catastroInfo.referencia || catastroInfo.direccion) && !catastroError && (
          <div className="p-4 bg-white rounded-lg shadow-lg">
            <h3 className="text-lg font-semibold text-slate-700 mb-2">Información Catastral</h3>
            {catastroInfo.referencia && <p className="text-sm text-slate-600"><strong>Referencia Catastral:</strong> {catastroInfo.referencia}</p>}
            {catastroInfo.direccion && <p className="text-sm text-slate-600"><strong>Dirección:</strong> {catastroInfo.direccion}</p>}
          </div>
        )}
        
        {coordinates && !isLoadingLocation && !isFetchingCatastroInfo && !catastroError && !locationError && 
         (!catastroInfo || (!catastroInfo.referencia && !catastroInfo.direccion)) && (
          <div className="mt-4 p-3 bg-amber-100 border-l-4 border-amber-500 text-amber-700 rounded" role="status">
            <p>No se encontró información catastral específica (referencia o dirección) para la ubicación, aunque la consulta al Catastro se realizó sin errores funcionales directos.</p>
          </div>
        )}

      </div> 
    </div> 
  );
};

export default App;

