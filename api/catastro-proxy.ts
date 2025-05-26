
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
    antiguedad?: string | null; // Added for construction year
  } | null;
  message?: string; // For "no data" or partial success/context messages
}

// Define a type for the parcel structure within lpcd
interface CatastroParcel {
  pc: {
    pc1: string;
    pc2: string;
    [key: string]: any; // Allow other properties within pc
  };
  ldt: string;
  dis: string; // Note: this comes as a string from the service
  [key: string]: any; // Allow other properties within a parcel
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
    const detRes = await fetch(detalleUrl, { 
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    const detBodyText = await detRes.text();
    console.log(`>>> CAT DETAILS STATUS: ${detRes.status}`);
    // Avoid logging potentially very large bodies in production if not needed
    // console.log(`>>> CAT DETAILS BODY: ${detBodyText}`); 
    
    const detJson = JSON.parse(detBodyText); 
    const detResult = detJson.Consulta_DNPRCResult;
    console.log('>>> CAT DETAILS JSON (Consulta_DNPRCResult):', JSON.stringify(detResult, null, 2));


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
      
      res.status(200).json({ 
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
    // Handle cases where bico or bico.bi might not exist or not be an array
    const bi = bico?.bi ? (Array.isArray(bico.bi) ? bico.bi[0] : bico.bi) : null;

    const usoPrincipal = bi?.luso || null;
    const superficie = bi?.sfc ? String(bi.sfc) : null;
    
    let antiguedad: string | null = null;
    const lcons = detResult?.lcons;
    if (lcons && Array.isArray(lcons) && lcons.length > 0) {
        const primeraConstruccion = lcons[0];
        if (primeraConstruccion?.dfcons?.ant) {
            antiguedad = String(primeraConstruccion.dfcons.ant);
        }
    }

    res.status(200).json({
      referenciaOriginal: refCat,
      direccionOriginalLDT: direccionLDT,
      distancia,
      datosDetallados: {
        direccionCompleta: direccionCompleta,
        usoPrincipal: usoPrincipal,
        superficie: superficie,
        antiguedad: antiguedad,
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
  const angulos = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]; // Added more angles

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
        const rres = await fetch(distanciaUrlAnillo, { method: 'GET', headers: { 'Accept': 'application/json' } });
        
        const ringBodyText = await rres.text();
        // console.log(`>>> CAT RING STATUS (${r}m, ${theta.toFixed(2)}rad): ${rres.status}`);
        // console.log(`>>> CAT RING BODY (${r}m, ${theta.toFixed(2)}rad): ${ringBodyText.substring(0, 500)}`); // Log snippet

        if (rres.status === 404) {
            console.warn(`Ring search: 404 para ${intentoX.toFixed(2)},${intentoY.toFixed(2)}.`);
            continue; 
        }

        if (!rres.ok) {
          console.warn(`Ring search: Consulta_RCCOOR_Distancia falló para ${intentoX.toFixed(2)},${intentoY.toFixed(2)} con status ${rres.status}`);
          continue; 
        }

        const ringJson = JSON.parse(ringBodyText); 
        const ringResult = ringJson.Consulta_RCCOOR_DistanciaResult;

        if (ringResult?.control?.cuerr === 0 && ringResult?.coordenadas_distancias?.coordd) {
          const coorddListRing = ringResult.coordenadas_distancias.coordd;
          if (!coorddListRing) { 
            console.warn("Ring search: 'coordd' is missing despite cuerr=0.");
            continue;
          }
          
          const firstCoorddRing = Array.isArray(coorddListRing) ? coorddListRing[0] : coorddListRing;
          if (!firstCoorddRing) {
            console.warn("Ring search: 'firstCoorddRing' is undefined after normalization.");
            continue;
          }

          const parcelsRawRing = firstCoorddRing.lpcd;
          if (!parcelsRawRing) {
            console.warn("Ring search: No 'lpcd' (parcel data array/object) found in firstCoorddRing.");
            continue;
          }

          const parcelsRing = Array.isArray(parcelsRawRing) ? parcelsRawRing : [parcelsRawRing];
          if (parcelsRing.length === 0) {
            console.warn("Ring search: 'lpcd' array is empty in firstCoorddRing.");
            continue;
          }
            
          const targetParcelRing = parcelsRing[0] as CatastroParcel; 
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
          } else {
            console.warn("Ring search: Parcela encontrada no contiene referencia catastral completa (pc1, pc2):", JSON.stringify(targetParcelRing, null, 2));
          }
        } else {
             if (ringResult?.control?.cuerr > 0) {
                console.warn(`Ring search: Consulta_RCCOOR_Distancia devolvió error ${ringResult.control.cuerr} - ${ringResult.lerr?.err?.des || 'Error desconocido'}`);
             } else {
                console.warn(`Ring search: No parcel data or cuerr > 0 for ${intentoX.toFixed(2)},${intentoY.toFixed(2)}`);
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
  console.log('► req.body:', JSON.stringify(req.body)); 

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
    '?CoorX=' + encodeURIComponent(utmX.toFixed(2)) + // Catastro seems to prefer 2 decimal places for UTM
    '&CoorY=' + encodeURIComponent(utmY.toFixed(2)) + 
    '&SRS=' + encodeURIComponent(srs);
  const distanciaUrl = baseDist + queryDist;

  console.log('▶︎ URL Distancia manual:', distanciaUrl);

  try {
    const distRes = await fetch(distanciaUrl, { 
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    const distBodyText = await distRes.text();
    // console.log(`>>> CAT DIST STATUS (Initial): ${distRes.status}`);
    // console.log(`>>> CAT DIST BODY (Initial): ${distBodyText.substring(0, 1000)}`); // Log snippet


    if (distRes.status === 404) {
      console.warn(`Consulta_RCCOOR_Distancia inicial devolvió 404 para ${utmX}, ${utmY}. Iniciando búsqueda por anillos.`);
      const respondedFromRings = await buscarPorAnillos(res, utmX, utmY, srs);
      if (!respondedFromRings) {
        res.status(200).json({
            referenciaOriginal: null, direccionOriginalLDT: null, distancia: null, datosDetallados: null,
            message: "No se encontró ninguna parcela catastral en la ubicación proporcionada (búsqueda inicial 404) ni en un radio de hasta 100 metros."
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
        // For client, send application-level error, not necessarily the Catastro HTTP status
        res.status(200).json({ 
            error: 'Error al consultar parcelas cercanas (inicial).',
            message: `${errorMsg} (Código: ${errorCode})`
        } as CatastroInfoDataForProxy & { error: string }); // Explicitly type the error response
        return;
    }
    
    const coorddList = distResult?.coordenadas_distancias?.coordd;
    if (!coorddList) {
        console.warn("Estructura inesperada (sin coordd) from Consulta_RCCOOR_Distancia (initial):", JSON.stringify(distJson, null, 2));
        // Attempt ring search as Catastro response might be incomplete for the exact point
        console.log("Respuesta inicial sin 'coordd'. Iniciando búsqueda por anillos.");
        const respondedFromRings = await buscarPorAnillos(res, utmX, utmY, srs);
        if (!respondedFromRings) {
            res.status(200).json({
                referenciaOriginal: null, direccionOriginalLDT: null, distancia: null, datosDetallados: null,
                message: 'Respuesta inesperada del Catastro (faltan datos de coordenadas), y búsqueda por anillos no encontró resultados.'
            } as CatastroInfoDataForProxy);
        }
        return;
    }

    // Flatten all parcels from all coordd items
    const todasParcels: CatastroParcel[] = [];
    const coorddArray = Array.isArray(coorddList) ? coorddList : [coorddList];

    for (const coorddItem of coorddArray) {
        if (coorddItem && coorddItem.lpcd) {
            const lpcdArray = Array.isArray(coorddItem.lpcd) ? coorddItem.lpcd : [coorddItem.lpcd];
            for (const parcel of lpcdArray) {
                if (parcel && parcel.pc && parcel.pc.pc1 && parcel.pc.pc2) {
                    todasParcels.push(parcel as CatastroParcel);
                }
            }
        }
    }
    
    if (todasParcels.length === 0) {
      console.warn("Búsqueda inicial (después de aplanar todas las parcelas) no encontró referencias válidas. Iniciando búsqueda por anillos.");
      const respondedFromRings = await buscarPorAnillos(res, utmX, utmY, srs);
      if (!respondedFromRings) {
        res.status(200).json({
          referenciaOriginal: null,
          direccionOriginalLDT: null,
          distancia: null,
          datosDetallados: null,
          message: "No se encontró ninguna parcela catastral válida en la ubicación proporcionada ni en un radio de hasta 100 metros (búsqueda inicial y expandida)."
        } as CatastroInfoDataForProxy);
      }
      return;
    }
    
    const primeraParcelaValida = todasParcels[0]; 

    const refCat = `${primeraParcelaValida.pc.pc1}${primeraParcelaValida.pc.pc2}`;
    const distancia = primeraParcelaValida.dis ? Number(primeraParcelaValida.dis) : null;
    const direccionLDT = primeraParcelaValida.ldt;

    console.log(`Parcela ${refCat} (primera válida de la lista aplanada) encontrada en la búsqueda inicial. Obteniendo detalles...`);
    await fetchParcelDetailsAndRespond(res, refCat, direccionLDT, distancia, "Parcela encontrada en la búsqueda inicial (primera válida de la lista completa).");
    return;

  } catch (err: any) {
    console.error("Error crítico en el handler del proxy:", err);
    const errorMessage = (err instanceof Error) ? err.message : 'Error interno del proxy.';
    // Avoid sending detailed stack in production for security
    const errorDetails = (err instanceof Error && err.stack && process.env.NODE_ENV !== 'production') ? err.stack : (typeof err === 'object' ? JSON.stringify(err) : String(err));
    
    res.status(500).json({ // Use 500 for actual proxy internal errors
      error: "Error interno del servidor proxy.", // Generic message for client
      details: process.env.NODE_ENV !== 'production' ? errorDetails : undefined // Only send details in dev
    });
  }
}

