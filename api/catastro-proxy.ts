
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

  // Construct the GET URL for the WCF JSON Catastro service
  // Endpoint: .../COVCCoordenadas.svc/json/Consulta_RCCOOR
  // Query params: CoorX, CoorY, SRS
  const catastroServiceUrl = new URL(`https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCoordenadas.svc/json/Consulta_RCCOOR`);
  catastroServiceUrl.searchParams.append('SRS', encodeURIComponent(srs)); // Ensure SRS is URL encoded if it contains special chars
  catastroServiceUrl.searchParams.append('CoorX', String(utmX));
  catastroServiceUrl.searchParams.append('CoorY', String(utmY));

  try {
    const catastroResponse = await fetch(catastroServiceUrl.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json', // Explicitly request JSON
      },
    });

    // Check if the response from Catastro is JSON
    const contentType = catastroResponse.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const jsonData = await catastroResponse.json();
      // Forward Catastro's JSON response
      res.setHeader('Content-Type', 'application/json;charset=UTF-8');
      res.status(catastroResponse.status).json(jsonData);
    } else {
      // If not JSON, it might be an error or unexpected response format
      const responseText = await catastroResponse.text();
      console.error("Catastro service did not return JSON. Status:", catastroResponse.status, "Body:", responseText);
      res.status(catastroResponse.status || 500).json({ 
        error: 'Catastro service did not return JSON.', 
        details: `Status: ${catastroResponse.status}. Response: ${responseText.substring(0, 500)}...` 
      });
    }

  } catch (error: any) {
    console.error("Proxy error connecting to Catastro API (WCF JSON GET request):", error);
    
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
        error: 'Internal Server Error in proxy while contacting Catastro API (WCF JSON).', 
        details: details 
    });
  }
}
