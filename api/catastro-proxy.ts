
// catastro-proxy.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

interface CatastroInfoDataForProxy {
  referenciaOriginal: string | null;
  direccionOriginalLDT: string | null;
  distancia: number | null;
  datosDetallados: {
    direccionCompleta: string | null;
    usoPrincipal: string | null;
    superficie: string | null;
  } | null;
  message?: string; // For "no data" or partial success/context messages
}

async function fetchParcelDetailsAndRespond(
  res: VercelResponse,
  refCat: string,
  direccionLDT: string,
  distancia: number | null,
  contextMessage?: string // Optional message (e.g., from ring search)
): Promise<void> {
  const baseDet =
    'https://ovc.catastro.meh.es/OVCServWeb/' +
    'OVCWcfCallejero/COVCCallejero.svc/json/Consulta_DNPRC';
  const queryDet = '?RefCat=' + encodeURIComponent(refCat);
  const detalleUrl = baseDet + queryDet;

  console.log('▶︎ URL Detalle manual:', detalleUrl);

  try {
    const detRes = await fetch(detalleUrl, { // Use the manually constructed string
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    const detBodyText = await detRes.text();
    console.log(`>>> CAT DETAILS STATUS: ${detRes.status}`);
    console.log(`>>> CAT DETAILS BODY: ${detBodyText}`);
    
    const detJson = JSON.parse(detBodyText); // Parse after logging
    const detResult = detJson.Consulta_DNPRCResult;

    let finalMessage = contextMessage || '';

    if (!detRes.ok || (detResult && detResult.control && detResult.control.cuerr > 0)) {
      let errorMsg = 'Error al obtener detalles de la finca.';
      let errorCode = detResult?.control?.cuerr || 'N/A';
      if (detResult?.lerr?.err) {
        const errDetails = Array.isArray(detResult.lerr.err) ? detResult.lerr.err[0] : detResult.lerr.err;
        errorMsg = errDetails.des ? errDetails.des.trim() : errorMsg;
        errorCode = errDetails.cod || errorCode;
      }
      console.error(`Error from Consulta_DNPRC for RC ${refCat}:`, JSON.stringify(detJson, null, 2));
      
      const detailsFetchError = `Fallo al obtener detalles para ${refCat}: ${errorMsg} (Código: ${errorCode})`;
      finalMessage = finalMessage ? `${finalMessage}. ${detailsFetchError}` : detailsFetchError;
      
      res.status(200).json({ // Return 200 with partial data and error message
        referenciaOriginal: refCat,
        direccionOriginalLDT: direccionLDT,
        distancia,
        datosDetallados: null,
        message: finalMessage,
      } as CatastroInfoDataForProxy);
      return;
    }

    let direccionCompleta = direccionLDT; 
    if (detResult?.dt?.loc?.dir) {
        const dir = detResult.dt.loc.dir;
        const parts = [
            dir.tv, dir.nv,
            dir.pnp ? `Nº ${dir.pnp}` : null,
            dir.snp ? `Nº ${dir.snp}` : null,
            dir.bloque, dir.escalera, dir.planta, dir.puerta,
            dir.dp ? `${dir.dp} ` : null,
            dir.nm ? dir.nm : null,
            dir.np ? `(${dir.np})` : null
        ].filter(Boolean).join(' ').trim();
        if (parts) direccionCompleta = parts;
    }
    
    const bico = detResult?.bico;
    const bi = bico && Array.isArray(bico.bi) ? bico.bi[0] : (bico?.bi || null);

    const usoPrincipal = bi?.luso || null;
    const superficie = bi?.sfc ? String(bi.sfc) : null;

    res.status(200).json({
      referenciaOriginal: refCat,
      direccionOriginalLDT: direccionLDT,
      distancia,
      datosDetallados: {
        direccionCompleta: direccionCompleta,
        usoPrincipal: usoPrincipal,
        superficie: superficie,
      },
      message: finalMessage || undefined, 
    } as CatastroInfoDataForProxy);

  } catch (detailsErr: any) {
    console.error(`Fetch/Processing Error in fetchParcelDetailsAndRespond for RC ${refCat}:`, detailsErr);
    let finalMessage = contextMessage || '';
    const detailsFetchError = `Error crítico al procesar detalles para ${refCat}: ${detailsErr.message}`;
    finalMessage = finalMessage ? `${finalMessage}. ${detailsFetchError}` : detailsFetchError;

    res.status(200).json({ 
      referenciaOriginal: refCat,
      direccionOriginalLDT: direccionLDT,
      distancia,
      datosDetallados: null,
      message: finalMessage,
    } as CatastroInfoDataForProxy);
  }
}

async function buscarPorAnillos(
  res: VercelResponse,
  originalUtmX: number,
  originalUtmY: number,
  srs: string
): Promise<boolean> { 
  const radios = [5, 10, 25, 50, 100]; 
  const angulos = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]; 

  console.log(`Iniciando búsqueda por anillos para ${originalUtmX}, ${originalUtmY}`);

  for (const r of radios) {
    for (const theta of angulos) {
      const dx = r * Math.cos(theta);
      const dy = r * Math.sin(theta);
      const intentoX = originalUtmX + dx;
      const intentoY = originalUtmY + dy;

      const baseDistAnillo =
        'https://ovc.catastro.meh.es/OVCServWeb/' +
        'OVCWcfCallejero/COVCCoordenadas.svc/json/Consulta_RCCOOR_Distancia';
      const queryDistAnillo =
        '?CoorX=' + encodeURIComponent(intentoX.toFixed(2)) +
        '&CoorY=' + encodeURIComponent(intentoY.toFixed(2)) +
        '&SRS=' + encodeURIComponent(srs);
      const distanciaUrlAnillo = baseDistAnillo + queryDistAnillo;
      
      console.log(`▶︎ URL Distancia Anillo manual (${r}m, ${theta.toFixed(2)}rad): ${distanciaUrlAnillo}`);

      try {
        const rres = await fetch(distanciaUrlAnillo, { method: 'GET', headers: { 'Accept': 'application/json' } }); // Use manually constructed string
        
        const ringBodyText = await rres.text();
        console.log(`>>> CAT RING STATUS (${r}m, ${theta.toFixed(2)}rad): ${rres.status}`);
        console.log(`>>> CAT RING BODY (${r}m, ${theta.toFixed(2)}rad): ${ringBodyText}`);

        if (rres.status === 404) continue; 

        if (!rres.ok) {
          console.warn(`Ring search: Consulta_RCCOOR_Distancia falló para ${intentoX.toFixed(2)},${intentoY.toFixed(2)} con status ${rres.status}`);
          continue; 
        }

        const json = JSON.parse(ringBodyText); 
        const result = json.Consulta_RCCOOR_DistanciaResult;

        if (result?.control?.cuerr === 0 && result?.coordenadas_distancias?.coordd) {
          const coorddRing = result.coordenadas_distancias.coordd;
          const firstParcelContainerRing = Array.isArray(coorddRing) ? coorddRing[0] : coorddRing;

          const lpcdRingRaw = firstParcelContainerRing?.lpcd; 
          if (lpcdRingRaw) { 
            const lpcdArrayRing = Array.isArray(lpcdRingRaw) ? lpcdRingRaw : [lpcdRingRaw];
            if (lpcdArrayRing.length > 0) {
              const targetParcelRing = lpcdArrayRing[0]; 
              if (targetParcelRing?.pc?.pc1 && targetParcelRing?.pc?.pc2) {
                const refCatFromRing = `${targetParcelRing.pc.pc1}${targetParcelRing.pc.pc2}`;
                const distanciaFromRing = targetParcelRing.dis ? Number(targetParcelRing.dis) : null;
                const direccionLDTFromRing = targetParcelRing.ldt;
                
                console.log(`Ring search: ÉXITO! Encontrada parcela ${refCatFromRing} en radio ${r}m.`);
                const ringContextMessage = `Parcela encontrada mediante búsqueda expandida (radio ${r}m).`;
                
                await fetchParcelDetailsAndRespond(
                  res,
                  refCatFromRing,
                  direccionLDTFromRing,
                  distanciaFromRing,
                  ringContextMessage
                );
                return true; 
              }
            }
          }
        }
      } catch (fetchErr: any) {
        console.warn(`Ring search: Error en fetch/procesamiento para ${intentoX.toFixed(2)},${intentoY.toFixed(2)}: ${fetchErr.message}`);
      }
    }
  }
  console.log(`Búsqueda por anillos completada para ${originalUtmX}, ${originalUtmY}. Sin resultados.`);
  return false; 
}


export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('► req.body:', JSON.stringify(req.body)); // Log incoming request body

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

  const baseDist =
    'https://ovc.catastro.meh.es/OVCServWeb/' +
    'OVCWcfCallejero/COVCCoordenadas.svc/json/Consulta_RCCOOR_Distancia';
  const queryDist =
    '?CoorX=' + encodeURIComponent(utmX) + // utmX is a number, encodeURIComponent will stringify
    '&CoorY=' + encodeURIComponent(utmY) + // utmY is a number, encodeURIComponent will stringify
    '&SRS=' + encodeURIComponent(srs);
  const distanciaUrl = baseDist + queryDist;

  console.log('▶︎ URL Distancia manual:', distanciaUrl);

  try {
    const distRes = await fetch(distanciaUrl, { // Use the manually constructed string
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    const distBodyText = await distRes.text();
    console.log(`>>> CAT DIST STATUS (Initial): ${distRes.status}`);
    console.log(`>>> CAT DIST BODY (Initial): ${distBodyText}`);


    if (distRes.status === 404) {
      console.warn(`Consulta_RCCOOR_Distancia inicial devolvió 404 para ${utmX}, ${utmY}. Iniciando búsqueda por anillos.`);
      const respondedFromRings = await buscarPorAnillos(res, utmX, utmY, srs);
      if (!respondedFromRings) {
        res.status(200).json({
            referenciaOriginal: null, direccionOriginalLDT: null, distancia: null, datosDetallados: null,
            message: "No se encontró ninguna parcela catastral en un radio de hasta 100 metros alrededor de la ubicación proporcionada."
        } as CatastroInfoDataForProxy);
      }
      return; 
    }
    
    const distJson = JSON.parse(distBodyText); 
    const distResult = distJson.Consulta_RCCOOR_DistanciaResult;

    if (!distRes.ok || (distResult?.control?.cuerr > 0)) {
        let errorMsg = 'Error en servicio de distancia del Catastro.';
        let errorCode = distResult?.control?.cuerr || 'N/A';
        if (distResult?.lerr?.err) {
            const errDetails = Array.isArray(distResult.lerr.err) ? distResult.lerr.err[0] : distResult.lerr.err;
            errorMsg = errDetails.des ? errDetails.des.trim() : errorMsg;
            errorCode = errDetails.cod || errorCode;
        }
        console.error("Error from Consulta_RCCOOR_Distancia (initial):", JSON.stringify(distJson, null, 2));
        res.status(distRes.ok ? 500 : distRes.status).json({ 
            error: 'Error al consultar parcelas cercanas (inicial).',
            details: `${errorMsg} (Código: ${errorCode})`
        });
        return;
    }
    
    if (!distResult?.coordenadas_distancias?.coordd) {
        console.error("Estructura inesperada (sin coordd) from Consulta_RCCOOR_Distancia (initial):", JSON.stringify(distJson, null, 2));
        res.status(200).json({
            referenciaOriginal: null, direccionOriginalLDT: null, distancia: null, datosDetallados: null,
            message: 'Respuesta inesperada del servicio de distancia del Catastro (faltan datos de coordenadas_distancias).'
        } as CatastroInfoDataForProxy);
        return;
    }

    const coordd = distResult.coordenadas_distancias.coordd;
    const firstParcelContainer = Array.isArray(coordd) ? coordd[0] : coordd;
    
    const lpcdInitialRaw = firstParcelContainer?.lpcd;
    if (!lpcdInitialRaw) {
        console.warn("No 'lpcd' (parcel data array/object) found in firstParcelContainer (initial, 200 OK):", JSON.stringify(distJson, null, 2));
        res.status(200).json({
            referenciaOriginal: null, direccionOriginalLDT: null, distancia: null, datosDetallados: null,
            message: "El servicio del Catastro respondió, pero no se encontraron datos de parcelas específicas (LPCD) en la respuesta inicial."
        } as CatastroInfoDataForProxy);
        return;
    }

    const lpcdArrayInitial = Array.isArray(lpcdInitialRaw) ? lpcdInitialRaw : [lpcdInitialRaw];
    if (lpcdArrayInitial.length === 0) {
        console.warn("'lpcd' array is empty in firstParcelContainer (initial, 200 OK):", JSON.stringify(distJson, null, 2));
        res.status(200).json({
            referenciaOriginal: null, direccionOriginalLDT: null, distancia: null, datosDetallados: null,
            message: "El servicio del Catastro respondió con una lista vacía de parcelas (LPCD) en la respuesta inicial."
        } as CatastroInfoDataForProxy);
        return;
    }
    
    const targetParcelInitial = lpcdArrayInitial[0]; 

    if (!targetParcelInitial?.pc?.pc1 || !targetParcelInitial?.pc?.pc2) {
        console.warn("Parcela más cercana (inicial) no contiene referencia catastral completa (pc1, pc2):", JSON.stringify(targetParcelInitial, null, 2));
        res.status(200).json({
            referenciaOriginal: null,
            direccionOriginalLDT: targetParcelInitial?.ldt || null,
            distancia: targetParcelInitial?.dis ? Number(targetParcelInitial.dis) : null,
            datosDetallados: null,
            message: 'La parcela más cercana encontrada (inicial) no contiene una referencia catastral completa.'
        } as CatastroInfoDataForProxy);
        return;
    }

    const refCat = `${targetParcelInitial.pc.pc1}${targetParcelInitial.pc.pc2}`;
    const distancia = targetParcelInitial.dis ? Number(targetParcelInitial.dis) : null;
    const direccionLDT = targetParcelInitial.ldt;

    console.log(`Parcela ${refCat} encontrada en la búsqueda inicial. Obteniendo detalles...`);
    await fetchParcelDetailsAndRespond(res, refCat, direccionLDT, distancia, "Parcela encontrada en la búsqueda inicial.");
    return;

  } catch (err: any) {
    console.error("Error crítico en el handler del proxy:", err);
    const errorMessage = (err instanceof Error) ? err.message : 'Error interno del proxy.';
    const errorDetails = (err instanceof Error && err.stack && process.env.NODE_ENV !== 'production') ? err.stack : (typeof err === 'object' ? JSON.stringify(err) : String(err));
    
    res.status(500).json({
      error: errorMessage,
      details: process.env.NODE_ENV !== 'production' ? errorDetails : undefined
    });
  }
}

