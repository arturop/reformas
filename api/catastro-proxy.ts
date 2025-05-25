
// catastro-proxy.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

  const distanciaUrl = new URL(
    'https://ovc.catastro.meh.es/OVCServWeb/' +
    'OVCWcfCallejero/COVCCoordenadas.svc/json/Consulta_RCCOOR_Distancia'
  );
  distanciaUrl.searchParams.append('CoorX', String(utmX));
  distanciaUrl.searchParams.append('CoorY', String(utmY));
  distanciaUrl.searchParams.append('SRS', srs);

  try {
    const distRes = await fetch(distanciaUrl.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    // Handle Catastro API's 404 for Consulta_RCCOOR_Distancia explicitly
    if (distRes.status === 404) {
        console.warn("Consulta_RCCOOR_Distancia devolvió 404 (No encontrado).");
        res.status(200).json({
            referenciaOriginal: null, direccionOriginalLDT: null, distancia: null, datosDetallados: null,
            message: "No se encontró ninguna parcela catastral cercana. El servicio del Catastro no tiene datos para esta área específica o las coordenadas están fuera de su ámbito (Error 404 desde Catastro)."
        });
        return;
    }

    const distJson = await distRes.json();
    const distResult = distJson.Consulta_RCCOOR_DistanciaResult;

    // Handle other HTTP errors from Catastro OR functional errors (cuerr > 0)
    if (!distRes.ok || (distResult?.control?.cuerr > 0)) {
        let errorMsg = 'Error en servicio de distancia del Catastro.';
        let errorCode = distResult?.control?.cuerr || 'N/A';
        if (distResult?.lerr?.err) {
            const errDetails = Array.isArray(distResult.lerr.err) ? distResult.lerr.err[0] : distResult.lerr.err;
            errorMsg = errDetails.des ? errDetails.des.trim() : errorMsg;
            errorCode = errDetails.cod || errorCode;
        }
        console.error("Error from Consulta_RCCOOR_Distancia:", JSON.stringify(distJson, null, 2));
        res.status(distRes.ok ? 500 : distRes.status).json({
            error: 'Error al consultar parcelas cercanas.',
            details: `${errorMsg} (Código: ${errorCode})`
        });
        return;
    }
    
    // Handle missing or malformed primary result structure after a 200 OK
    if (!distResult?.coordenadas_distancias?.coordd) {
        console.error("Estructura inesperada (sin coordd) from Consulta_RCCOOR_Distancia:", JSON.stringify(distJson, null, 2));
        res.status(200).json({
            referenciaOriginal: null, direccionOriginalLDT: null, distancia: null, datosDetallados: null,
            message: 'Respuesta inesperada del servicio de distancia del Catastro (faltan datos de coordenadas_distancias).'
        });
        return;
    }

    const coordd = distResult.coordenadas_distancias.coordd;
    const firstParcelContainer = Array.isArray(coordd) ? coordd[0] : coordd;

    // Handle missing 'pcd' (parcel details list) within the container
    if (!firstParcelContainer?.lpcd?.pcd) {
        console.warn("No 'pcd' (parcel data) found in Consulta_RCCOOR_Distancia (200 OK):", JSON.stringify(distJson, null, 2));
        res.status(200).json({
            referenciaOriginal: null, direccionOriginalLDT: null, distancia: null, datosDetallados: null,
            message: "El servicio del Catastro respondió, pero no se encontraron datos de parcelas específicas (PCD) en la respuesta."
        });
        return;
    }
    
    const pcdList = firstParcelContainer.lpcd.pcd;
    const pcd = Array.isArray(pcdList) ? pcdList[0] : pcdList;

    // Handle if the closest parcel found doesn't have essential reference info
    if (!pcd?.pc?.pc1 || !pcd?.pc?.pc2) {
        console.warn("Parcela más cercana no contiene referencia catastral completa (pc1, pc2):", JSON.stringify(pcd, null, 2));
        res.status(200).json({
            referenciaOriginal: null,
            direccionOriginalLDT: pcd?.ldt || null,
            distancia: pcd?.dis || null,
            datosDetallados: null,
            message: 'La parcela más cercana encontrada no contiene una referencia catastral completa.'
        });
        return;
    }

    const refCat = `${pcd.pc.pc1}${pcd.pc.pc2}`;
    const distancia = pcd.dis;
    const direccionLDT = pcd.ldt;

    // 4) Llamada a Consulta_DNPRC para detalles de la finca
    const detalleUrl = new URL(
      `https://ovc.catastro.hacienda.gob.es/OVCServWeb/` +
      `OVCWcfCallejero/COVCCallejero.svc/json/Consulta_DNPRC`
    );
    detalleUrl.searchParams.append('RC', refCat);
    
    const detRes = await fetch(detalleUrl.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    const detJson = await detRes.json();
    const detResult = detJson.Consulta_DNPRCResult;

    if (!detRes.ok || (detResult && detResult.control && detResult.control.cuerr > 0)) {
        let errorMsg = 'Error al obtener detalles de la finca.';
        let errorCode = detResult?.control?.cuerr || 'N/A';
        if (detResult && detResult.lerr && detResult.lerr.err) {
            const errDetails = Array.isArray(detResult.lerr.err) ? detResult.lerr.err[0] : detResult.lerr.err;
            errorMsg = errDetails.des ? errDetails.des.trim() : errorMsg;
            errorCode = errDetails.cod || errorCode;
        }
        console.error("Error from Consulta_DNPRC:", JSON.stringify(detJson, null, 2));
        // Return partial data with error
        res.status(detRes.status !== 200 ? detRes.status : 500).json({
          error: 'Se encontró una parcela cercana pero no se pudieron obtener sus detalles completos.',
          details: `${errorMsg} (Código: ${errorCode})`,
          referenciaOriginal: refCat,
          direccionOriginalLDT: direccionLDT,
          distancia,
          datosDetallados: null, // Indicate details are missing
          message: `Se encontró parcela ${refCat} pero falló la obtención de detalles: ${errorMsg} (Código: ${errorCode})`
        });
        return;
    }
    
    // 5) Empaqueta y reenvía
    const direccionCompleta = detResult?.dt?.loc?.dir?.td || 
                             (detResult?.dt?.loc?.dir ? `${detResult.dt.loc.dir.tv || ''} ${detResult.dt.loc.dir.nv || ''}`.trim() : null) ||
                             direccionLDT; 
    
    const usoPrincipal = detResult?.bico?.[0]?.luso || detResult?.bico?.luso || null;
    const superficie = detResult?.bico?.[0]?.sfc || detResult?.bico?.sfc || null;

    res.status(200).json({
      referenciaOriginal: refCat,
      direccionOriginalLDT: direccionLDT, 
      distancia,
      datosDetallados: {
        direccionCompleta: direccionCompleta,
        usoPrincipal: usoPrincipal,
        superficie: superficie ? String(superficie) : null
      }
    });

  } catch (err: any) {
    console.error("Error en el handler del proxy:", err);
    res.status(500).json({
      error: err.message || 'Error interno del proxy.',
      details: (typeof err === 'object' && err.stack) ? err.stack : (typeof err === 'object' ? JSON.stringify(err) : String(err))
    });
  }
}

