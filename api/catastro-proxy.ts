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

  const soapRequestBody = `
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cat="http://catastro.meh.es/">
   <soapenv:Header/>
   <soapenv:Body>
      <cat:Consulta_CPMRC>
         <cat:Coord>
            <cat:xc>${utmX}</cat:xc>
            <cat:yc>${utmY}</cat:yc>
            <cat:sr>${srs}</cat:sr>
         </cat:Coord>
      </cat:Consulta_CPMRC>
   </soapenv:Body>
</soapenv:Envelope>
  `.trim();

  const catastroApiUrl = `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx`;

  try {
    const catastroResponse = await fetch(catastroApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml;charset=UTF-8',
        'SOAPAction': 'http://catastro.meh.es/Consulta_CPMRC' // Important for SOAP
      },
      body: soapRequestBody,
    });

    const responseText = await catastroResponse.text();

    // Forward Catastro's status code and content type
    res.setHeader('Content-Type', catastroResponse.headers.get('Content-Type') || 'text/xml;charset=UTF-8');
    res.status(catastroResponse.status).send(responseText);

  } catch (error: any) {
    console.error("Proxy error connecting to Catastro API:", error);
    res.status(500).json({ 
        error: 'Internal Server Error in proxy while contacting Catastro API.', 
        details: error.message 
    });
  }
}
