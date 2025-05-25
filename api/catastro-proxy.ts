
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { utmX, utmY, srs } = req.body;

  if (typeof utmX !== 'number' || typeof utmY !== 'number' || typeof srs !== 'string') {
    res.status(400).json({ error: 'Invalid request body: utmX (number), utmY (number), and srs (string) are required.' });
    return;
  }

  const soapRequestBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header/>
  <soap:Body>
    <Consulta_CPMRC xmlns="http://catastro.meh.es/">
      <Coord>
        <xc>${utmX}</xc>
        <yc>${utmY}</yc>
        <sr>${srs}</sr>
      </Coord>
    </Consulta_CPMRC>
  </soap:Body>
</soap:Envelope>
  `.trim();

  const catastroApiUrl = `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx`;

  try {
    const catastroResponse = await fetch(catastroApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml;charset=UTF-8',
        // Reverted to WSDL-specified SOAPAction, ensuring it's quoted for the HTTP header
        'SOAPAction': '"http://catastro.meh.es/Consulta_CPMRC"'
      },
      body: soapRequestBody,
    });

    const responseText = await catastroResponse.text();

    res.setHeader('Content-Type', catastroResponse.headers.get('Content-Type') || 'text/xml;charset=UTF-8');
    res.status(catastroResponse.status).send(responseText);

  } catch (error: any) {
    console.error("Proxy error connecting to Catastro API:", error);
    
    let details = error.message;
    if (error.cause) {
      const cause = error.cause as any; // Type assertion for easier access
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
        error: 'Internal Server Error in proxy while contacting Catastro API.', 
        details: details 
    });
  }
}

