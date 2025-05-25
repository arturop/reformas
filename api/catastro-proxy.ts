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
  const detalleUrl = new URL(
    `https://ovc.catastro.hacienda.gob.es/OVCServWeb/` +
    `OVCWcfCallejero/COVCCallejero.svc/json/Consulta_DNPRC`
  );
  detalleUrl.searchParams.append('RC', refCat);

  console.log(`>>> CAT DETAILS URL: ${detalleUrl.toString()}`);

  try {
    const detRes = await fetch(detalleUrl.toString(), {
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

    const direccionCompletaArr = [];
    if (detResult?.dt?.loc?.dir?.tv) direccionCompletaArr.push(detResult.dt.loc.dir.tv);
    if (detResult?.dt?.loc?.dir?.nv) direccionCompletaArr.push(detResult.dt.loc.dir.nv);
    if (detResult?.dt?.loc?.dir?.pnp) direccionCompletaArr.push(`Nº ${detResult.dt.loc.dir.pnp}`);
    if (detResult?.dt?.loc?.dir?.kilometro) direccionCompletaArr.push(`Km ${detResult.dt.loc.dir.kilometro}`);


    const direccionCompleta = direccionCompletaArr.length > 0 ? direccionCompletaArr.join(' ') : direccionLDT;
    
    const usoPrincipal = detResult?.bico?.[0]?.luso || detResult?.bico?.luso || null;
    const superficie = detResult?.bico?.[0]?.sfc || detResult?.bico?.sfc || null;

    res.status(200).json({
      referenciaOriginal: refCat,
      direccionOriginalLDT: direccionLDT,
      distancia,
      datosDetallados: {
        direccionCompleta: direccionCompleta,
        usoPrincipal: usoPrincipal,
        superficie: superficie ? String(superficie) : null,
      },
      message: finalMessage || undefined, // Only include message if it's not empty
    } as CatastroInfoDataForProxy);

  } catch (detailsErr: any) {
    console.error(`Fetch/Processing Error in fetchParcelDetailsAndRespond for RC ${refCat}:`, detailsErr);
    let finalMessage = contextMessage || '';
    const detailsFetchError = `Error crítico al procesar detalles para ${refCat}: ${detailsErr.message}`;
    finalMessage = finalMessage ? `${finalMessage}. ${detailsFetchError}` : detailsFetchError;

    res.status(200).json({ // Return 200 with partial data and error message
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
): Promise<boolean> { // true if response sent, false otherwise
  const radios = [5, 10, 25, 50, 100]; // meters
  const angulos = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]; // N, E, S, W

  console.log(`Iniciando búsqueda por anillos para ${originalUtmX}, ${originalUtmY}`);

  for (const r of radios) {
    for (const theta of angulos) {
      const dx = r * Math.cos(theta);
      const dy = r * Math.sin(theta);
      const intentoX = originalUtmX + dx;
      const intentoY = originalUtmY + dy;

      const url = new URL(
        'https://ovc.catastro.meh.es/OVCServWeb/' +
        'OVCWcfCallejero/COVCCoordenadas.svc/json/Consulta_RCCOOR_Distancia'
      );
      url.searchParams.append('CoorX', intentoX.toFixed(2));
      url.searchParams.append('CoorY', intentoY.toFixed(2));
      url.searchParams.append('SRS', srs);
      
      console.log(`>>> CAT RING URL: ${url.toString()}`);

      try {
        const rres = await fetch(url.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
        
        const ringBodyText = await rres.text();
        console.log(`>>> CAT RING STATUS (${r}m, ${theta}rad): ${rres.status}`);
        console.log(`>>> CAT RING BODY (${r}m, ${theta}rad): ${ringBodyText}`);

        if (rres.status === 404) continue; // No luck here, try next point

        if (!rres.ok) {
          console.warn(`Ring search: Consulta_RCCOOR_Distancia falló para ${intentoX.toFixed(2)},${intentoY.toFixed(2)} con status ${rres.status}`);
          continue; // Try next point
        }

        const json = JSON.parse(ringBodyText); // Parse after logging
        const result = json.Consulta_RCCOOR_DistanciaResult;

        if (result?.control?.cuerr === 0 && result?.coordenadas_distancias?.coordd) {
          const coorddRing = result.coordenadas_distancias.coordd;
          const firstParcelContainerRing = Array.isArray(coorddRing) ? coorddRing[0] : coorddRing;

          if (firstParcelContainerRing?.lpcd?.pcd) {
            const pcdListRing = firstParcelContainerRing.lpcd.pcd;
            const pcdRing = Array.isArray(pcdListRing) ? pcdListRing[0] : pcdListRing;

            if (pcdRing?.pc?.pc1 && pcdRing?.pc?.pc2) {
              const refCatFromRing = `${pcdRing.pc.pc1}${pcdRing.pc.pc2}`;
              const distanciaFromRing = pcdRing.dis;
              const direccionLDTFromRing = pcdRing.ldt;
              
              console.log(`Ring search: ÉXITO! Encontrada parcela ${refCatFromRing} en radio ${r}m.`);
              const ringContextMessage = `Parcela encontrada mediante búsqueda expandida (radio ${r}m).`;
              
              await fetchParcelDetailsAndRespond(
                res,
                refCatFromRing,
                direccionLDTFromRing,
                distanciaFromRing,
                ringContextMessage
              );
              return true; // Found and response sent
            }
          }
        }
      } catch (fetchErr: any) {
        console.warn(`Ring search: Error en fetch/procesamiento para ${intentoX.toFixed(2)},${intentoY.toFixed(2)}: ${fetchErr.message}`);
        // Continue to next attempt
      }
    }
  }
  console.log(`Búsqueda por anillos completada para ${originalUtmX}, ${originalUtmY}. Sin resultados.`);
  return false; // Exhausted all attempts
}


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

  console.log(`>>> CAT DIST URL (Initial): ${distanciaUrl.toString()}`);

  try {
    const distRes = await fetch(distanciaUrl.toString(), {
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

    // --- Process non-404 responses from initial Consulta_RCCOOR_Distancia ---
    const distJson = JSON.parse(distBodyText); // Parse after logging
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
        res.status(distRes.ok ? 500 : distRes.status).json({ // Keep original status if !ok, else 500 for functional error
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

    if (!firstParcelContainer?.lpcd?.pcd) {
        console.warn("No 'pcd' (parcel data) found in Consulta_RCCOOR_Distancia (initial, 200 OK):", JSON.stringify(distJson, null, 2));
        res.status(200).json({
            referenciaOriginal: null, direccionOriginalLDT: null, distancia: null, datosDetallados: null,
            message: "El servicio del Catastro respondió, pero no se encontraron datos de parcelas específicas (PCD) en la respuesta inicial."
        } as CatastroInfoDataForProxy);
        return;
    }
    
    const pcdList = firstParcelContainer.lpcd.pcd;
    const pcd = Array.isArray(pcdList) ? pcdList[0] : pcdList;

    if (!pcd?.pc?.pc1 || !pcd?.pc?.pc2) {
        console.warn("Parcela más cercana (inicial) no contiene referencia catastral completa (pc1, pc2):", JSON.stringify(pcd, null, 2));
        res.status(200).json({
            referenciaOriginal: null,
            direccionOriginalLDT: pcd?.ldt || null,
            distancia: pcd?.dis || null,
            datosDetallados: null,
            message: 'La parcela más cercana encontrada (inicial) no contiene una referencia catastral completa.'
        } as CatastroInfoDataForProxy);
        return;
    }

    const refCat = `${pcd.pc.pc1}${pcd.pc.pc2}`;
    const distancia = pcd.dis;
    const direccionLDT = pcd.ldt;

    console.log(`Parcela ${refCat} encontrada en la búsqueda inicial. Obteniendo detalles...`);
    await fetchParcelDetailsAndRespond(res, refCat, direccionLDT, distancia, "Parcela encontrada en la búsqueda inicial.");
    return;

  } catch (err: any) {
    console.error("Error crítico en el handler del proxy:", err);
    res.status(500).json({
      error: err.message || 'Error interno del proxy.',
      details: (typeof err === 'object' && err.stack) ? err.stack : (typeof err === 'object' ? JSON.stringify(err) : String(err))
    });
  }
}