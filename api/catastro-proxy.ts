
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

  // Ajustado para coincidir con el ejemplo del servicio .asmx
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
        // Modificado según sugerencia: SOAPAction con el dominio ovc y https
        'SOAPAction': '"https://ovc.catastro.meh.es/Consulta_CPMRC"'
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

