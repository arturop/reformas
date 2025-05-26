
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
    valorCatastral?: string | null;
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

    console.log('>>> CAT DETAILS RAW JSON (detJson):', JSON.stringify(detJson, null, 2));

    let detResultPayload: any = null; 

    if (detJson && typeof detJson.consulta_dnprcResult !== 'undefined') { // Prioritize lowercase 'c' based on cURL sample
        detResultPayload = detJson.consulta_dnprcResult;
        console.log('Source for details payload: detJson.consulta_dnprcResult (lowercase c). Content:', JSON.stringify(detResultPayload, null, 2));
    } else if (detJson && typeof detJson.Consulta_DNPRCResult !== 'undefined') { // Fallback to uppercase 'C'
        detResultPayload = detJson.Consulta_DNPRCResult;
        console.warn('WARN: Using fallback detJson.Consulta_DNPRCResult (uppercase C) as details payload. Content:', JSON.stringify(detResultPayload, null, 2));
    } else if (detJson && (detJson.lrcdnb || detJson.lrcdnp || detJson.control || detJson.lerr)) {
        detResultPayload = detJson;
        console.warn("WARN: Main result wrapper (consulta_dnprcResult or Consulta_DNPRCResult) was missing. Treating detJson itself as the detail payload. Content:", JSON.stringify(detResultPayload, null, 2));
    }

    if (!detResultPayload) {
        console.error("CRITICAL: Unrecognized Catastro details response structure. Neither 'consulta_dnprcResult', 'Consulta_DNPRCResult', nor a fallback structure was found in detJson. Original detJson:", JSON.stringify(detJson, null, 2));
        let messageForClient = "Respuesta del servicio de detalles del Catastro no reconocida o vacía.";
        if (detJson && typeof detJson.mensaje === 'string') { 
            messageForClient = detJson.mensaje;
        } else if (detJson?.lerr?.err?.des && typeof detJson.lerr.err.des === 'string') { 
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
    
    let accumulatedMessage = contextMessage || '';

    if (detResultPayload.control?.cuerr > 0 && detResultPayload.control.cuerr !== 168 ) { // 168 seems to be a valid count for multiple results, not an error itself for DNPRC
      let errorMsg = 'Error al obtener detalles de la finca desde Catastro.';
      let errorCode = detResultPayload.control.cuerr || 'N/A';
      if (detResultPayload.lerr?.err) {
        const errDetails = Array.isArray(detResultPayload.lerr.err) ? detResultPayload.lerr.err[0] : detResultPayload.lerr.err;
        errorMsg = errDetails.des ? errDetails.des.trim() : errorMsg;
        errorCode = errDetails.cod || errorCode;
      }
      console.error(`Error from Consulta_DNPRC (via detResultPayload.control.cuerr) for RC ${refCat}:`, JSON.stringify(detResultPayload, null, 2));
      
      const detailsFetchError = `Fallo al obtener detalles para ${refCat}: ${errorMsg} (Código: ${errorCode})`;
      accumulatedMessage = accumulatedMessage ? `${accumulatedMessage}. ${detailsFetchError}` : detailsFetchError;
      
      res.status(200).json({ 
        referenciaOriginal: refCat,
        direccionOriginalLDT: direccionLDT,
        distancia,
        datosDetallados: null,
        message: accumulatedMessage,
      } as CatastroInfoDataForProxy);
      return;
    }
    
    let datosDetalladosObject: CatastroInfoDataForProxy['datosDetallados'] = null;
    let primerBienInmuebleDataForExtraction: any = null;
    let propertyList: any[] = [];

    // Try path from cURL sample: detResultPayload.lrcdnp.rcdnp
    if (detResultPayload.lrcdnp?.rcdnp && Array.isArray(detResultPayload.lrcdnp.rcdnp)) {
        propertyList = detResultPayload.lrcdnp.rcdnp;
        console.log("Property list found at: detResultPayload.lrcdnp.rcdnp. Count:", propertyList.length);
        if (propertyList.length > 0) {
            // This structure has details directly in the items
            primerBienInmuebleDataForExtraction = propertyList[0];
            console.log("Using first item from 'lrcdnp.rcdnp' directly for extraction.");
        }
    } 
    // Fallback to previously assumed path: detResultPayload.lrcdnb.lrcdnb (which expects .bi inside)
    else if (detResultPayload.lrcdnb?.lrcdnb && Array.isArray(detResultPayload.lrcdnb.lrcdnb)) {
        propertyList = detResultPayload.lrcdnb.lrcdnb;
        console.log("Property list found at: detResultPayload.lrcdnb.lrcdnb. Count:", propertyList.length);
        if (propertyList.length > 0 && propertyList[0]?.bi) {
            primerBienInmuebleDataForExtraction = propertyList[0].bi;
            console.log("Using '.bi' from first item of 'lrcdnb.lrcdnb' for extraction.");
        } else if (propertyList.length > 0) {
            console.warn("WARN: Item in 'lrcdnb.lrcdnb' found, but it's missing the '.bi' sub-object. Item:", JSON.stringify(propertyList[0], null, 2));
        }
    }


    if (primerBienInmuebleDataForExtraction) {
        console.log("Data for extraction (primerBienInmuebleDataForExtraction):", JSON.stringify(primerBienInmuebleDataForExtraction, null, 2));
        
        let extractedDireccionCompleta: string | null = null;
        let extractedUsoPrincipal: string | null = null;
        let extractedSuperficie: string | null = null;
        let extractedAntiguedad: string | null = null;
        let extractedValorCatastral: string | null = null;

        // Structure from cURL sample (e.g., has 'debi' and 'dt.locs')
        if (primerBienInmuebleDataForExtraction.debi && primerBienInmuebleDataForExtraction.dt?.locs) {
            console.log("Extracting details using 'debi' and 'dt.locs' structure (from lrcdnp.rcdnp like sample).");
            const dirObj = primerBienInmuebleDataForExtraction.dt.locs.lous?.lourb?.dir;
            const lointObj = primerBienInmuebleDataForExtraction.dt.locs.lous?.loint;
            
            let streetAddressParts: string[] = [];
            if (dirObj) {
                if (dirObj.tv) streetAddressParts.push(dirObj.tv);
                if (dirObj.nv) streetAddressParts.push(dirObj.nv);
                if (dirObj.pnp) streetAddressParts.push(`Nº ${dirObj.pnp}`);
                if (dirObj.plp) streetAddressParts.push(dirObj.plp); // Letra portal
                // dirObj.td (e.g., "ADELFAS II") can be complex, might be part of nv or separate.
                // For now, let's assume LDT covers this building name well if not in nv.
                // If dirObj.td exists and is not already in dirObj.nv, consider appending.
            }
            let fullStreetAddress = streetAddressParts.join(' ').trim();
            if (dirObj?.td && !fullStreetAddress.includes(dirObj.td)) {
                 fullStreetAddress = `${fullStreetAddress} ${dirObj.td}`.trim();
            }


            let internalAddressParts: string[] = [];
            if (lointObj) {
                if (lointObj.bq) internalAddressParts.push(`Blq. ${lointObj.bq}`);
                if (lointObj.es) internalAddressParts.push(`Esc. ${lointObj.es}`);
                if (lointObj.pt) internalAddressParts.push(`Pl. ${lointObj.pt}`);
                if (lointObj.pu) internalAddressParts.push(`Pta. ${lointObj.pu}`);
            }
            const fullInternalAddress = internalAddressParts.join(', ').trim();
            
            extractedDireccionCompleta = [fullStreetAddress, fullInternalAddress].filter(Boolean).join(', ').trim();
            
            // Fallback if constructed address is empty
            if (!extractedDireccionCompleta && direccionLDT) {
                extractedDireccionCompleta = direccionLDT;
            } else if (!extractedDireccionCompleta && !direccionLDT && primerBienInmuebleDataForExtraction.dt?.locs?.lous?.lourb?.dir?.nv) {
                // Absolute fallback to just street name if LDT is also missing
                extractedDireccionCompleta = primerBienInmuebleDataForExtraction.dt.locs.lous.lourb.dir.nv;
            }


            extractedUsoPrincipal = primerBienInmuebleDataForExtraction.debi.luso ? String(primerBienInmuebleDataForExtraction.debi.luso) : null;
            extractedSuperficie = primerBienInmuebleDataForExtraction.debi.sfc ? String(primerBienInmuebleDataForExtraction.debi.sfc) : null;
            extractedAntiguedad = primerBienInmuebleDataForExtraction.debi.ant ? String(primerBienInmuebleDataForExtraction.debi.ant) : null;
            extractedValorCatastral = primerBienInmuebleDataForExtraction.debi.cpt ? String(primerBienInmuebleDataForExtraction.debi.cpt) : null;
        } 
        // Fallback to older assumed structure (e.g., has .dtcat or .dirmun from a .bi object)
        else if (primerBienInmuebleDataForExtraction.dtcat || primerBienInmuebleDataForExtraction.dirmun) {
            console.log("Extracting details using 'dirmun'/'dt'/'dtcat' structure (likely from lrcdnb.lrcdnb[0].bi).");
            if (primerBienInmuebleDataForExtraction.dirmun?.dir) {
                if (typeof primerBienInmuebleDataForExtraction.dirmun.dir === 'string') {
                    extractedDireccionCompleta = primerBienInmuebleDataForExtraction.dirmun.dir.trim();
                } else if (primerBienInmuebleDataForExtraction.dirmun.dir.hasOwnProperty('nv') && typeof primerBienInmuebleDataForExtraction.dirmun.dir.nv === 'string') { 
                     const dirDetails = primerBienInmuebleDataForExtraction.dirmun.dir;
                     const addressParts = [
                        dirDetails.tv, dirDetails.nv, 
                        dirDetails.pnp ? `Nº ${dirDetails.pnp}` : null,
                        dirDetails.snp ? `-${dirDetails.snp}` : null, // segundo numero
                        dirDetails.bq, dirDetails.es, dirDetails.pt, dirDetails.pu  
                     ].filter(val => val !== null && val !== undefined && String(val).trim() !== '').join(' ').trim();
                     if (addressParts) extractedDireccionCompleta = addressParts;
                }
            }
            if ((!extractedDireccionCompleta || extractedDireccionCompleta === '') && direccionLDT) {
                extractedDireccionCompleta = direccionLDT; 
            }

            extractedUsoPrincipal = primerBienInmuebleDataForExtraction.dt?.luso ? String(primerBienInmuebleDataForExtraction.dt.luso) : null;
            extractedSuperficie = primerBienInmuebleDataForExtraction.dt?.sfc ? String(primerBienInmuebleDataForExtraction.dt.sfc) : null;
            extractedAntiguedad = primerBienInmuebleDataForExtraction.dtcat?.ant ? String(primerBienInmuebleDataForExtraction.dtcat.ant) : null;
            extractedValorCatastral = primerBienInmuebleDataForExtraction.dtcat?.vc?.v ? String(primerBienInmuebleDataForExtraction.dtcat.vc.v) : null;
        } else {
            console.warn("primerBienInmuebleDataForExtraction does not match known structures for detail extraction:", JSON.stringify(primerBienInmuebleDataForExtraction, null, 2));
            const noStructureMsg = 'La estructura de datos del inmueble no coincide con los formatos esperados para extraer detalles.';
            accumulatedMessage = accumulatedMessage ? `${accumulatedMessage}. ${noStructureMsg}` : noStructureMsg;
        }

        if (extractedDireccionCompleta || extractedUsoPrincipal || extractedSuperficie || extractedAntiguedad || extractedValorCatastral) {
            datosDetalladosObject = {
                direccionCompleta: extractedDireccionCompleta,
                usoPrincipal: extractedUsoPrincipal,
                superficie: extractedSuperficie,
                antiguedad: extractedAntiguedad,
                valorCatastral: extractedValorCatastral,
            };
            console.log("Detalles extraídos y asignados a datosDetalladosObject:", JSON.stringify(datosDetalladosObject, null, 2));
            const detailsFoundMsg = "Bien inmueble encontrado y detalles procesados.";
            accumulatedMessage = accumulatedMessage ? `${accumulatedMessage}. ${detailsFoundMsg}` : detailsFoundMsg;
        } else if (primerBienInmuebleDataForExtraction) { // Data was there but nothing extracted
             const noExtraDetailsMsg = "Bien inmueble localizado, pero no se pudieron extraer detalles adicionales específicos (uso, superficie, etc.) de la estructura recibida.";
             accumulatedMessage = accumulatedMessage ? `${accumulatedMessage}. ${noExtraDetailsMsg}` : noExtraDetailsMsg;
             console.log(noExtraDetailsMsg);
        }

    } else {
        const noStructureMsg = 'No se encontró una estructura de datos de inmueble reconocible en la respuesta de Catastro para extraer detalles.';
        accumulatedMessage = accumulatedMessage ? `${accumulatedMessage}. ${noStructureMsg}` : noStructureMsg;
        console.warn(`No se encontró 'primerBienInmuebleDataForExtraction' en detResultPayload para RC ${refCat}. ${accumulatedMessage}`);
    }
    
    res.status(200).json({
      referenciaOriginal: refCat,
      direccionOriginalLDT: direccionLDT,
      distancia,
      datosDetallados: datosDetalladosObject, 
      message: accumulatedMessage.trim() || undefined, 
    } as CatastroInfoDataForProxy);

  } catch (detailsErr: any) {
    console.error(`Fetch/Processing Error Critical in fetchParcelDetailsAndRespond for RC ${refCat}:`, detailsErr);
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

