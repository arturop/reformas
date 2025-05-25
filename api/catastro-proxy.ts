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

  // 1) Llamada a Consulta_RCCOOR_Distancia usando CoorX/CoorY
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
    const distJson = await distRes.json();

    // 2) Chequea errores funcionales y de HTTP
    const distResult = distJson.Consulta_RCCOOR_DistanciaResult;
    if (!distRes.ok || (distResult && distResult.control && distResult.control.cuerr > 0)) {
      let errorMsg = 'Error en servicio de distancia del Catastro.';
      let errorCode = distResult?.control?.cuerr || 'N/A';
      if (distResult && distResult.lerr && distResult.lerr.err) {
          const errDetails = Array.isArray(distResult.lerr.err) ? distResult.lerr.err[0] : distResult.lerr.err;
          errorMsg = errDetails.des ? errDetails.des.trim() : errorMsg;
          errorCode = errDetails.cod || errorCode;
      }
      console.error("Error from Consulta_RCCOOR_Distancia:", JSON.stringify(distJson, null, 2));
      res.status(distRes.status !== 200 ? distRes.status : 500).json({ // Use actual error status or 500
        error: 'Error al consultar parcelas cercanas.',
        details: `${errorMsg} (Código: ${errorCode})` 
      });
      return;
    }
    
    if (!distResult || !distResult.coordenadas_distancias || !distResult.coordenadas_distancias.coordd) {
        console.error("Unexpected structure from Consulta_RCCOOR_Distancia:", JSON.stringify(distJson, null, 2));
        res.status(500).json({ error: 'Respuesta inesperada del servicio de distancia del Catastro.' });
        return;
    }

    // 3) Toma la primera referencia más próxima
    const coordd = distResult.coordenadas_distancias.coordd;
    const firstParcelContainer = Array.isArray(coordd) ? coordd[0] : coordd;

    if (!firstParcelContainer || !firstParcelContainer.lpcd || !firstParcelContainer.lpcd.pcd) {
        console.warn("No 'pcd' (parcel data) found in Consulta_RCCOOR_Distancia response:", JSON.stringify(distJson, null, 2));
        res.status(404).json({ error: 'No se encontraron parcelas catastrales en la respuesta para las coordenadas proporcionadas.' });
        return;
    }
    const pcdList = firstParcelContainer.lpcd.pcd;
    const pcd = Array.isArray(pcdList) ? pcdList[0] : pcdList;

    if (!pcd || !pcd.pc || !pcd.pc.pc1 || !pcd.pc.pc2) {
        console.warn("Parcela más cercana no contiene referencia catastral (pc1, pc2):", JSON.stringify(pcd, null, 2));
        res.status(404).json({ error: 'No se pudo determinar la referencia catastral de la parcela más cercana.' });
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
          datosDetallados: null,
        });
        return;
    }
    
    // 5) Empaqueta y reenvía
    // Extract data carefully, as fields might be missing
    const direccionCompleta = detResult?.dt?.loc?.dir?.td || // Attempt to get full formatted address if available
                             (detResult?.dt?.loc?.dir ? `${detResult.dt.loc.dir.tv || ''} ${detResult.dt.loc.dir.nv || ''}`.trim() : null) ||
                             direccionLDT; // Fallback to LDT if no better address from DNPRC
    
    const usoPrincipal = detResult?.bico?.[0]?.luso || detResult?.bico?.luso || null;
    const superficie = detResult?.bico?.[0]?.sfc || detResult?.bico?.sfc || null;


    res.status(200).json({
      referenciaOriginal: refCat,
      direccionOriginalLDT: direccionLDT, // LDT from first call
      distancia,
      datosDetallados: {
        direccionCompleta: direccionCompleta,
        usoPrincipal: usoPrincipal,
        superficie: superficie ? String(superficie) : null // Ensure superficie is string or null
      }
    });

  } catch (err: any) {
    console.error("Error en el handler del proxy:", err);
    // Generic error, unsure if partial data is available
    res.status(500).json({
      error: err.message || 'Error interno del proxy.',
      details: (typeof err === 'object' && err.stack) ? err.stack : (typeof err === 'object' ? JSON.stringify(err) : String(err))
    });
  }
}

