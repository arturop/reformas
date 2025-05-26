
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
    antiguedad?: string | null; 
  } | null;
  message?: string; 
}

interface CatastroParcel {
  pc: {
    pc1: string;
    pc2: string;
    [key: string]: any; 
  };
  ldt: string;
  dis: string; 
  [key: string]: any; 
}

// Helper to ensure a value is an array (for bi, lcons which can be single or array)
function normalizeToArray<T>(item: T | T[] | undefined | null): T[] {
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

async function fetchParcelDetailsAndRespond(
  res: VercelResponse,
  refCat: string,
  direccionLDT: string,
  distancia: number | null,
  contextMessage?: string 
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
    
    let detJson: any;
    try {
      detJson = JSON.parse(detBodyText);
    } catch (parseError: any) {
      console.error(`Error parsing JSON from Consulta_DNPRC for RC ${refCat}:`, parseError, `Body text (first 500 chars): ${detBodyText.substring(0, 500)}`);
      const parseErrorMessage = `Error al interpretar la respuesta detallada del Catastro (no es JSON válido).`;
      res.status(200).json({
        referenciaOriginal: refCat,
        direccionOriginalLDT: direccionLDT,
        distancia,
        datosDetallados: null,
        message: `${contextMessage ? contextMessage + '. ' : ''}${parseErrorMessage}`,
      } as CatastroInfoDataForProxy);
      return;
    }

    console.log('>>> CAT DETAILS RAW JSON:', JSON.stringify(detJson, null, 2));

    if (!detJson || typeof detJson.Consulta_DNPRCResult === 'undefined') {
      console.warn("Consulta_DNPRCResult no encontrado o 'undefined' en la respuesta de Catastro. Respuesta completa:", JSON.stringify(detJson, null, 2));
      
      let messageForClient = "No se encontraron detalles específicos para la finca en Catastro.";
      if (detJson && Object.keys(detJson).length === 0) {
        messageForClient = "Respuesta vacía del Catastro al solicitar detalles de la finca.";
      } else if (detJson && typeof detJson.mensaje === 'string') {
        messageForClient = detJson.mensaje;
      } else if (detJson && detJson.lerr && detJson.lerr.err && typeof detJson.lerr.err.des === 'string') {
          messageForClient = detJson.lerr.err.des;
      }

      res.status(200).json({
        referenciaOriginal: refCat,
        direccionOriginalLDT: direccionLDT,
        distancia: distancia,
        datosDetallados: null,
        message: `${contextMessage ? contextMessage + '. ' : ''}${messageForClient}`,
      } as CatastroInfoDataForProxy);
      return;
    }
    
    const detResult = detJson.Consulta_DNPRCResult;
    // This log is fine here as detResult is now confirmed to exist.
    console.log('>>> CAT DETAILS JSON (Consulta_DNPRCResult):', JSON.stringify(detResult, null, 2)); 

    let finalMessage = contextMessage || '';

    if (detResult?.control?.cuerr > 0) {
      let errorMsg = 'Error al obtener detalles de la finca desde Catastro.';
      let errorCode = detResult?.control?.cuerr || 'N/A';
      if (detResult?.lerr?.err) {
        const errDetails = Array.isArray(detResult.lerr.err) ? detResult.lerr.err[0] : detResult.lerr.err;
        errorMsg = errDetails.des ? errDetails.des.trim() : errorMsg;
        errorCode = errDetails.cod || errorCode;
      }
      console.error(`Error from Consulta_DNPRC (within result) for RC ${refCat}:`, JSON.stringify(detResult, null, 2));
      
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

    // --- Start of new hierarchical data source determination ---
    let topLevelDataSourceForItem: any = null;
    let debiSource: any = null; // Specific to lrcdnp structure
    let biSource: any = null;   // Specific to bico/bi structures
    let dtSource: any = null;
    let lconsSource: any = null; // Specific to bico/bi structures

    if (detResult.lrcdnp?.rcdnp && Array.isArray(detResult.lrcdnp.rcdnp) && detResult.lrcdnp.rcdnp.length > 0) {
      topLevelDataSourceForItem = detResult.lrcdnp.rcdnp[0];
      if (topLevelDataSourceForItem) {
        debiSource = topLevelDataSourceForItem.debi;
        dtSource = topLevelDataSourceForItem.dt;
        // lcons is not typically a direct child of rcdnp items, antiquity is in debi.ant
      }
      console.log("Usando detResult.lrcdnp.rcdnp[0] como fuente de datos.");
    } else if (detResult.bico && Array.isArray(detResult.bico) && detResult.bico.length > 0) {
      topLevelDataSourceForItem = detResult.bico[0];
      if (topLevelDataSourceForItem) {
        biSource = topLevelDataSourceForItem.bi;
        dtSource = topLevelDataSourceForItem.dt;
        lconsSource = topLevelDataSourceForItem.lcons;
      }
      console.log("Usando detResult.bico[0] como fuente de datos (fallback desde lrcdnp).");
    } else if (detResult.bi) {
      topLevelDataSourceForItem = detResult; // The parent object itself is the top-level item
      biSource = topLevelDataSourceForItem.bi;
      dtSource = topLevelDataSourceForItem.dt;
      lconsSource = topLevelDataSourceForItem.lcons;
      console.log("Usando detResult (nivel superior) como fuente de datos (bi encontrado, fallback desde lrcdnp/bico).");
    }
    // --- End of new hierarchical data source determination ---

    if (!topLevelDataSourceForItem) {
      console.warn(`No se encontró 'lrcdnp.rcdnp', 'bico' con elementos, ni 'bi' en detResult para RC ${refCat}.`);
      finalMessage = finalMessage ? `${finalMessage}. No se encontró una estructura de datos de propiedad reconocible en la respuesta de Catastro.` 
                                  : 'No se encontró una estructura de datos de propiedad reconocible en la respuesta de Catastro.';
      res.status(200).json({
        referenciaOriginal: refCat,
        direccionOriginalLDT: direccionLDT,
        distancia,
        datosDetallados: null,
        message: finalMessage,
      } as CatastroInfoDataForProxy);
      return;
    }
    
    // --- Start of new detail extraction based on determined sources ---
    let extractedDireccionCompleta: string | null = null;
    if (dtSource?.loc?.dir) {
        const dir = dtSource.loc.dir;
        const parts = [
            dir.tv, dir.nv,
            dir.pnp ? `Nº ${dir.pnp}` : null,
            dir.snp ? `Nº ${dir.snp}` : null,
            dir.bloque, dir.escalera, dir.planta, dir.puerta,
            dir.dp ? `${dir.dp} ` : null,
            dir.nm ? dir.nm : null,
            dir.np ? `(${dir.np})` : null
        ].filter(Boolean).join(' ').trim();
        if (parts) extractedDireccionCompleta = parts;
    }
     if (!extractedDireccionCompleta || extractedDireccionCompleta === direccionLDT) { // Fallback or if constructed is same as LDT
        extractedDireccionCompleta = direccionLDT; // Ensure it's at least LDT if available
    }


    let extractedUsoPrincipal: string | null = null;
    let extractedSuperficie: string | null = null;
    let extractedAntiguedad: string | null = null;

    if (debiSource) { // Path for lrcdnp.rcdnp
        extractedUsoPrincipal = debiSource.luso || null;
        extractedSuperficie = debiSource.sfc ? String(debiSource.sfc) : null;
        extractedAntiguedad = debiSource.ant ? String(debiSource.ant) : null;
        console.log("Extrayendo detalles desde 'debiSource' (lrcdnp).");
    } else { // Fallback paths for bico or bi
        const normalizedBiArray = normalizeToArray(biSource);
        const biDataToUse = normalizedBiArray.length > 0 ? normalizedBiArray[0] : null;

        extractedUsoPrincipal = topLevelDataSourceForItem?.usoPrincipal || biDataToUse?.luso || null;
        extractedSuperficie = topLevelDataSourceForItem?.superficie ? String(topLevelDataSourceForItem.superficie) 
                                : (biDataToUse?.sfc ? String(biDataToUse.sfc) : null);
        
        extractedAntiguedad = topLevelDataSourceForItem?.antiguedad ? String(topLevelDataSourceForItem.antiguedad) : null;
        if (!extractedAntiguedad) {
            const normalizedLconsArray = normalizeToArray(lconsSource);
            if (normalizedLconsArray.length > 0 && normalizedLconsArray[0]?.dfcons?.ant) {
                extractedAntiguedad = String(normalizedLconsArray[0].dfcons.ant);
            }
        }
        console.log("Extrayendo detalles desde 'biSource'/'lconsSource' (bico/bi fallback).");
    }
    // --- End of new detail extraction ---
    
    let datosDetalladosObject: CatastroInfoDataForProxy['datosDetallados'] = null;

    const hasSpecificDetails = 
        (extractedDireccionCompleta && extractedDireccionCompleta !== direccionLDT) ||
        extractedUsoPrincipal || 
        extractedSuperficie || 
        extractedAntiguedad;

    if (hasSpecificDetails) {
        datosDetalladosObject = {
            direccionCompleta: extractedDireccionCompleta,
            usoPrincipal: extractedUsoPrincipal,
            superficie: extractedSuperficie,
            antiguedad: extractedAntiguedad,
        };
    } else {
      finalMessage = finalMessage ? `${finalMessage}. No se encontraron detalles adicionales significativos para la finca.` 
                                  : `No se encontraron detalles adicionales significativos para la finca. Mostrando información básica.`;
    }

    res.status(200).json({
      referenciaOriginal: refCat,
      direccionOriginalLDT: direccionLDT,
      distancia,
      datosDetallados: datosDetalladosObject,
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
  const angulos = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4];

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

        if (rres.status === 404) {
            console.warn(`Ring search: 404 para ${intentoX.toFixed(2)},${intentoY.toFixed(2)}.`);
            continue; 
        }

        if (!rres.ok) {
          console.warn(`Ring search: Consulta_RCCOOR_Distancia falló para ${intentoX.toFixed(2)},${intentoY.toFixed(2)} con status ${rres.status}`);
          continue; 
        }
        
        let ringJson: any;
        try {
            ringJson = JSON.parse(ringBodyText);
        } catch (parseError: any) {
            console.warn(`Ring search: Error parsing JSON for ${intentoX.toFixed(2)},${intentoY.toFixed(2)}: ${parseError.message}. Body: ${ringBodyText.substring(0,200)}`);
            continue;
        }

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
    '?CoorX=' + encodeURIComponent(utmX.toFixed(2)) +
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
    
    let distJson: any;
    try {
        distJson = JSON.parse(distBodyText);
    } catch (parseError: any) {
        console.error(`Error parsing JSON from initial Consulta_RCCOOR_Distancia:`, parseError, `Body text (first 500 chars): ${distBodyText.substring(0, 500)}`);
        res.status(200).json({
            referenciaOriginal: null, direccionOriginalLDT: null, distancia: null, datosDetallados: null,
            message: 'Error al interpretar la respuesta inicial del Catastro (no es JSON válido).'
        } as CatastroInfoDataForProxy);
        return;
    }
    
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
        res.status(200).json({ 
            referenciaOriginal: null, direccionOriginalLDT: null, distancia: null, datosDetallados: null,
            message: `Error al consultar parcelas cercanas (inicial): ${errorMsg} (Código: ${errorCode})`
        } as CatastroInfoDataForProxy);
        return;
    }
    
    const coorddList = distResult?.coordenadas_distancias?.coordd;
    if (!coorddList) {
        console.warn("Estructura inesperada (sin coordd) from Consulta_RCCOOR_Distancia (initial):", JSON.stringify(distJson, null, 2));
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
    
    res.status(500).json({
      error: "Error interno del servidor proxy.", 
      details: process.env.NODE_ENV !== 'production' ? errorMessage : undefined 
    });
  }
}

