

import React, { useState, useCallback, useEffect } from 'react';
import proj4 from 'proj4';
import '@/lib/projDefs'; // Ensure EPSG:23030 definition is loaded

interface CatastroInfoData {
  referenciaOriginal: string | null;
  direccionOriginalLDT: string | null;
  distancia: number | null;
  datosDetallados: {
    direccionCompleta: string | null;
    usoPrincipal: string | null;
    superficie: string | null;
    antiguedad?: string | null;
    valorCatastral?: string | null; // Added
  } | null;
  message?: string;
}

// Types for proxy response
type ProxyErrorResponse = { 
  error: string; 
  details?: string; 
  // Include fields from CatastroInfoData if proxy might return partial data on error
  referenciaOriginal?: string | null;
  direccionOriginalLDT?: string | null;
  distancia?: number | null;
  message?: string;
};
type ProxySuccessResponse = CatastroInfoData;
type ProxyResponse = ProxyErrorResponse | ProxySuccessResponse;


const App: React.FC = () => {
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
      
      // Check if the HTTP response itself is not OK (e.g., 404, 500)
      if (!response.ok) {
        const errorText = await response.text(); // Get error text from server
        console.error(`Error from proxy: Status ${response.status}`, errorText);
        setCatastroError(`Error del servidor (proxy): ${response.status} - ${errorText.substring(0, 150)}${errorText.length > 150 ? '...' : ''}`);
        setCatastroInfo(null); // Ensure no stale data
        setIsFetchingCatastroInfo(false);
        return;
      }

      // If response.ok, then try to parse JSON
      const jsonData = await response.json() as ProxyResponse;
      console.log('>>> App.tsx: jsonData received from proxy:', JSON.stringify(jsonData, null, 2));


      // Check for application-level errors within the JSON response
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
      // This catch block will now primarily handle network errors or if response.json() fails 
      // for reasons other than a non-ok HTTP status (which should be rare if response.ok was true).
      if (e instanceof SyntaxError && e.message.toLowerCase().includes('json')) {
        // This can still happen if response.ok was true but the body was not valid JSON
        setCatastroError(`Error: La respuesta del proxy no fue JSON válido a pesar de un estado OK. ${e.message}`);
      } else {
        setCatastroError(`Error de red o al procesar la solicitud al proxy: ${e.message}`);
      }
    } finally {
      setIsFetchingCatastroInfo(false);
    }
  };

  // useEffect to fetch Catastro info when coordinates are available
  useEffect(() => {
    if (coordinates) {
      fetchCatastroInfo(coordinates);
    }
  }, [coordinates]); // Re-run when coordinates change

  const handleGetLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError("La geolocalización no es compatible con tu navegador.");
      setIsLoadingLocation(false);
      return;
    }

    setIsLoadingLocation(true);
    setLocationError(null);
    setCoordinates(null); // Clear previous coordinates
    setCatastroInfo(null);
    setCatastroError(null);
    setUtmCoordinatesForDisplay(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoordinates(position.coords); // Set coordinates, which will trigger the useEffect
        setIsLoadingLocation(false);
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
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);


  // Determine button text and state
  let buttonText = 'Obtener Ubicación y Datos Catastrales';
  let isButtonBusy = isLoadingLocation || isFetchingCatastroInfo;
  if (isLoadingLocation) {
    buttonText = 'Obteniendo Ubicación...';
  } else if (isFetchingCatastroInfo) {
    buttonText = 'Consultando Catastro...';
  }

  const renderCatastroData = () => {
    if (!catastroInfo) return null;

    // Don't render this section if the primary info (refCat) is missing and there's a specific "no parcel" message
    // The "no parcel" message is handled by renderAlerts
    if (!catastroInfo.referenciaOriginal && catastroInfo.message) {
        return null;
    }

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
        {/* This message is for partial data scenarios where primary data might exist but details failed, 
            and the proxy attached a specific message about that failure. */}
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

  const renderAlerts = () => {
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
          {/* Render partial Catastro info if available even with error and message exists */}
          {catastroInfo && catastroInfo.referenciaOriginal && catastroInfo.message && renderCatastroData()}
        </div>
      );
    }
    // Handle "no parcel found" message from proxy (200 OK, but no refCat and a message)
    if (catastroInfo && !catastroInfo.referenciaOriginal && catastroInfo.message) {
        return (
            <div className="mt-4 p-3 bg-amber-100 border-l-4 border-amber-500 text-amber-700 rounded" role="status">
                <p className="font-bold">Sin Parcela Catastral</p>
                <p>{catastroInfo.message}</p>
                <p className="text-sm mt-1">Quizá tu ubicación esté en el límite entre parcelas o fuera de una zona con datos catastrales disponibles.</p>
            </div>
        );
    }
    // Fallback message if no specific data was found after a successful-looking flow but catastroInfo is null
    if (coordinates && !isLoadingLocation && !isFetchingCatastroInfo && !catastroError && !locationError && !catastroInfo) {
        return (
            <div className="mt-4 p-3 bg-amber-100 border-l-4 border-amber-500 text-amber-700 rounded" role="status">
                <p>No se pudo obtener información catastral para la ubicación. El servicio del Catastro no devolvió datos o hubo un problema en la comunicación.</p>
            </div>
        );
    }
    return null;
  }

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
            disabled={isButtonBusy}
            className="w-full bg-cyan-500 hover:bg-cyan-600 text-white font-semibold py-3 px-4 rounded-lg shadow-md transition-colors duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-opacity-75 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-live="polite"
            aria-busy={isButtonBusy}
          >
            {/* Spinner can be added here if desired, e.g. an SVG */}
            {isButtonBusy && <span className="inline-block animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white mr-2"></span>}
            {buttonText}
          </button>
        </div>
        
        {renderAlerts()}

        {/* Display Catastro Info if available */}
        {/* Updated condition: renderCatastroData if there's a refCat, OR if there's a message about partial data (even if refCat is there) */}
        {catastroInfo && (catastroInfo.referenciaOriginal || (catastroInfo.message && !catastroError)) && renderCatastroData()}
        
        {/* Display Coordinates Info if available and no locationError */}
        {(coordinates || utmCoordinatesForDisplay) && !locationError && renderCoordinatesData()}

      </div> 
    </div> 
  );
};

export default App;
