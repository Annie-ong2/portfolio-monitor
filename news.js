// Vercel 서버리스 함수 — 뉴스 RSS 프록시
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'url 파라미터가 필요해요' });
  }

  try {
    const response = await fetch(decodeURIComponent(url), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RSSReader/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'RSS 요청 실패' });
    }

    const text = await response.text();
    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    return res.status(200).send(text);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
