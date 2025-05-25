
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'POST') { // Frontend still POSTs to this proxy
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ error: 'Method Not Allowed. Proxy expects POST from frontend.' });
    return;
  }

  const { utmX, utmY, srs } = req.body;

  if (typeof utmX !== 'number' || typeof utmY !== 'number' || typeof srs !== 'string') {
    res.status(400).json({ error: 'Invalid request body: utmX (number), utmY (number), and srs (string) are required.' });
    return;
  }

  // Construct the GET URL for Catastro service
  // Note: Parameter names are Coordenada_X, Coordenada_Y, SRS as per Catastro's GET interface
  const catastroServiceUrl = new URL(`https://ovc.catastro.meh.es/ovcservweb/ovcswlocalizacionrc/ovccoordenadas.asmx/Consulta_RCCOOR`);
  catastroServiceUrl.searchParams.append('SRS', srs);
  catastroServiceUrl.searchParams.append('Coordenada_X', String(utmX));
  catastroServiceUrl.searchParams.append('Coordenada_Y', String(utmY));

  try {
    const catastroResponse = await fetch(catastroServiceUrl.toString(), {
      method: 'GET',
      headers: {
        // No SOAPAction needed for GET
        // 'Accept': 'application/xml' // Optional, but good practice
      },
    });

    const responseText = await catastroResponse.text();

    // Forward Catastro's response (status, content-type, body)
    res.setHeader('Content-Type', catastroResponse.headers.get('Content-Type') || 'application/xml;charset=UTF-8'); // Default to XML
    res.status(catastroResponse.status).send(responseText);

  } catch (error: any) {
    console.error("Proxy error connecting to Catastro API (GET request):", error);
    
    let details = error.message;
    if (error.cause) {
      const cause = error.cause as any; 
      let causeDetails = [];
      if (cause.message) causeDetails.push(cause.message);
      if (cause.code) causeDetails.push(`Code: ${cause.code}`);
      if (cause.errno) causeDetails.push(`Errno: ${cause.errno}`);
      if (cause.syscall) causeDetails.push(`Syscall: ${cause.syscall}`);
      
      if (causeDetails.length > 0) {
        details += ` (Cause: ${causeDetails.join('; ')})`;
      } else if (typeof cause === 'object' && cause !== null) {
        details += ` (Cause: ${JSON.stringify(cause)})`;
      } else {
        details += ` (Cause: ${String(cause)})`;
      }
    }

    res.status(500).json({ 
        error: 'Internal Server Error in proxy while contacting Catastro API via GET.', 
        details: details 
    });
  }
}


