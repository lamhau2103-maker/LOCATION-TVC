/**
 * Vercel Serverless Function: /api/farms
 * Hỗ trợ nhận tham số `mid` qua query (/api/farms?mid=ID),
 * nếu không có trên query thì dùng biến môi trường process.env.MYMAPS_ID.
 */
export default async function handler(req: any, res: any) {
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed. Chỉ hỗ trợ GET.' });
    return;
  }

  const queryMid =
    typeof req.query?.mid === 'string' ? req.query.mid.trim() : '';
  const envMid = (process.env.MYMAPS_ID || '').trim();
  const myMapsId =
    queryMid ||
    (envMid !== 'YOUR_GOOGLE_MY_MAPS_ID' ? envMid : '');

  if (!myMapsId) {
    res.status(503).json({
      error:
        'Chưa có tham số mid hoặc biến môi trường MYMAPS_ID trên server.',
      code: 'MISSING_MYMAPS_ID',
    });
    return;
  }

  const kmlUrl = `https://www.google.com/maps/d/kml?mid=${encodeURIComponent(
    myMapsId
  )}&forcekml=1&t=${Date.now()}`;

  try {
    const response = await fetch(kmlUrl, {
      cache: 'no-store',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; ThaiVietCorpSync/3.0; +https://vercel.com)',
        Accept:
          'application/vnd.google-earth.kml+xml, application/xml, text/xml, */*',
        'Cache-Control': 'no-cache',
      },
    });

    if (!response.ok) {
      res.status(response.status).json({
        error: `Google My Maps trả về mã lỗi ${response.status}. Hãy kiểm tra quyền chia sẻ 'Bất kỳ ai có đường liên kết đều có thể xem'.`,
        code: 'GOOGLE_MYMAPS_HTTP_ERROR',
        status: response.status,
      });
      return;
    }

    const kmlText = await response.text();

    if (!kmlText.includes('<kml') && !kmlText.includes('<Placemark')) {
      res.status(502).json({
        error:
          'Nội dung trả về từ Google My Maps không phải là KML hợp lệ. Hãy chắc chắn bản đồ đã bật chia sẻ Công khai.',
        code: 'INVALID_KML_RESPONSE',
      });
      return;
    }

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate'
    );
    res.status(200).send(kmlText);
  } catch (error) {
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : 'Không thể kết nối tới máy chủ Google My Maps.',
      code: 'NETWORK_ERROR',
    });
  }
}
