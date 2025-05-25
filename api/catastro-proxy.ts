
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Helper function to safely access nested properties
const get = (obj: any, path: string, defaultValue: any = undefined) => {
  const value = path
    .split('.')
    .reduce((a, b) => (a && typeof a === 'object' ? a[b] : undefined), obj);
  return typeof value === 'undefined' ? defaultValue : value;
};

// Helper function to format address from DNPRC data
const formatDNPRCAddress = (dir: any): string | null => {
  if (!dir || typeof dir !== 'object') return null;
  
  const parts = [
    dir.tv, // Tipo de vía
    dir.nv, // Nombre de la vía
    dir.pnp ? `Nº ${dir.pnp}` : null, // Número de policía
    dir.pns ? `Portal ${dir.pns}` : null,
    dir.pl ? `Planta ${dir.pl}` : null,
    dir.pu ? `Puerta ${dir.pu}` : null,
    dir.km ? `Km ${dir.km}` : null,
  ].filter(Boolean).join(' ');

  const locationParts = [
    get(dir, 'loine.cp', null), // Código postal
    get(dir, 'loine.nm', null), // Nombre del municipio (si disponible directamente) o de la entidad menor
  ].filter(Boolean).join(' ');
  
  const municipality = get(dir, 'loine.cm.dn', null); // Nombre del municipio
  const province = get(dir, 'loine.cm.dp.dn', null); // Nombre de la provincia

  let fullAddress = parts;
  if (locationParts) fullAddress += `, ${locationParts}`;
  if (municipality && (!locationParts || !locationParts.includes(municipality))) fullAddress += `, ${municipality}`;
  if (province) fullAddress += ` (${province})`;
  
  return fullAddress.trim() || null;
};


export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ error: 'Method Not Allowed. Proxy expects POST from frontend.' });
    return;
  }

  const { utmX, utmY, srs } = req.body;

  if (typeof utmX !== 'number' || typeof utmY !== 'number' || typeof srs !== 'string') {
    res.status(400).json({ error: 'Invalid request body: utmX (number), utmY (number), and srs (string) are required.' });
    return;
  }

  // Step 1: Call Consulta_RCCOOR_Distancia
  const distanciaServiceUrl = new URL(`https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCoordenadas.svc/json/Consulta_RCCOOR_Distancia`);
  distanciaServiceUrl.searchParams.append('SRS', encodeURIComponent(srs));
  distanciaServiceUrl.searchParams.append('CoorX', String(utmX));
  distanciaServiceUrl.searchParams.append('CoorY', String(utmY));

  let closestParcelData;
  let refCatastralOriginal;
  let direccionOriginalLDT;
  let distanciaMetros;

  try {
    const distanciaResponse = await fetch(distanciaServiceUrl.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    const distanciaJsonData = await distanciaResponse.json();

    if (!distanciaResponse.ok || get(distanciaJsonData, 'Consulta_RCCOOR_DistanciaResult.control.cuerr', 0) > 0) {
      const errorDesc = get(distanciaJsonData, 'Consulta_RCCOOR_DistanciaResult.lerr.err.des', 'Error en servicio de distancia del Catastro.');
      const errorCode = get(distanciaJsonData, 'Consulta_RCCOOR_DistanciaResult.lerr.err.cod', get(distanciaJsonData, 'Consulta_RCCOOR_DistanciaResult.control.cuerr', 'N/A'));
      console.error("Error from Consulta_RCCOOR_Distancia:", JSON.stringify(distanciaJsonData, null, 2));
      res.status(distanciaResponse.status || 500).json({ 
        error: 'Error al consultar parcelas cercanas.', 
        details: `${errorDesc} (Código: ${errorCode})` 
      });
      return;
    }
    
    const parcels = get(distanciaJsonData, 'Consulta_RCCOOR_DistanciaResult.coordenadas_distancias.coordd.0.lpcd.pcd');
    if (!parcels || (Array.isArray(parcels) && parcels.length === 0)) {
      res.status(404).json({ error: 'No se encontraron parcelas catastrales cercanas a las coordenadas proporcionadas.' });
      return;
    }
    
    closestParcelData = Array.isArray(parcels) ? parcels[0] : parcels; // Assuming first is closest or only one
    
    if (!closestParcelData || !get(closestParcelData, 'pc.pc1') || !get(closestParcelData, 'pc.pc2')) {
        res.status(404).json({ error: 'No se pudo determinar la referencia catastral de la parcela más cercana.' });
        return;
    }

    refCatastralOriginal = `${get(closestParcelData, 'pc.pc1')}${get(closestParcelData, 'pc.pc2')}`;
    direccionOriginalLDT = get(closestParcelData, 'ldt', 'N/A');
    distanciaMetros = get(closestParcelData, 'dis', null);

  } catch (error: any) {
    console.error("Proxy error during Consulta_RCCOOR_Distancia:", error);
    res.status(500).json({ error: 'Error interno del proxy al consultar parcelas cercanas.', details: error.message });
    return;
  }

  // Step 2: Call Consulta_DNPRC with the obtained Cadastral Reference
  const dnprcServiceUrl = new URL(`https://ovc.catastro.hacienda.gob.es/OVCServWeb/OVCWcfCallejero/COVCCallejero.svc/json/Consulta_DNPRC`);
  dnprcServiceUrl.searchParams.append('RC', refCatastralOriginal);

  try {
    const dnprcResponse = await fetch(dnprcServiceUrl.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    const dnprcJsonData = await dnprcResponse.json();

    if (!dnprcResponse.ok || get(dnprcJsonData, 'Consulta_DNPRCResult.control.cuerr', 0) > 0) {
      // DNPRC errors might be structured differently, e.g., under Consulta_DNPRCResult.lerr
      const errorDesc = get(dnprcJsonData, 'Consulta_DNPRCResult.lerr.err.des', 'Error al obtener detalles de la finca.');
      const errorCode = get(dnprcJsonData, 'Consulta_DNPRCResult.lerr.err.cod', get(dnprcJsonData, 'Consulta_DNPRCResult.control.cuerr', 'N/A'));
      console.error("Error from Consulta_DNPRC:", JSON.stringify(dnprcJsonData, null, 2));
      // Return partial data if available
      res.status(dnprcResponse.status || 500).json({
        error: 'Se encontró una parcela cercana pero no se pudieron obtener sus detalles completos.',
        details: `${errorDesc} (Código: ${errorCode})`,
        referenciaOriginal: refCatastralOriginal,
        direccionOriginalLDT: direccionOriginalLDT,
        distancia: distanciaMetros,
        datosDetallados: null, // Indicate details fetch failed
      });
      return;
    }
    
    const datosFinca = get(dnprcJsonData, 'Consulta_DNPRCResult.bico.0') || get(dnprcJsonData, 'Consulta_DNPRCResult.bico'); // bico can be an array or object
    const datosDireccion = get(dnprcJsonData, 'Consulta_DNPRCResult.dt.0.loc.dir') || get(dnprcJsonData, 'Consulta_DNPRCResult.dt.loc.dir');

    if (!datosFinca && !datosDireccion) {
      // Successful call but no specific bico/dt data found
      console.warn("Consulta_DNPRC successful but no bico/dt data found, returning partial info. JSON:", JSON.stringify(dnprcJsonData, null, 2));
      res.status(200).json({
        referenciaOriginal: refCatastralOriginal,
        direccionOriginalLDT: direccionOriginalLDT,
        distancia: distanciaMetros,
        datosDetallados: null, // No specific details found
        message: "Se encontró la referencia de la parcela más cercana, pero no se encontraron datos detallados adicionales (uso, superficie, dirección completa)."
      });
      return;
    }


    const direccionCompleta = formatDNPRCAddress(datosDireccion);
    const usoPrincipal = get(datosFinca, 'luso', 'N/A');
    const superficie = get(datosFinca, 'sfc', 'N/A'); // Typically includes " m2"

    res.status(200).json({
      referenciaOriginal: refCatastralOriginal,
      direccionOriginalLDT: direccionOriginalLDT,
      distancia: distanciaMetros,
      datosDetallados: {
        direccionCompleta: direccionCompleta,
        usoPrincipal: usoPrincipal,
        superficie: String(superficie), // Ensure it's a string
      },
    });

  } catch (error: any) {
    console.error("Proxy error during Consulta_DNPRC:", error);
    // Return partial data if available
    res.status(500).json({
        error: 'Error interno del proxy al obtener detalles de la finca.',
        details: error.message,
        referenciaOriginal: refCatastralOriginal,
        direccionOriginalLDT: direccionOriginalLDT,
        distancia: distanciaMetros,
        datosDetallados: null, // Indicate details fetch failed
    });
  }
}
