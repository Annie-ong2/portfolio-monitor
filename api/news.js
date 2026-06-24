export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store'); // 캐시 방지 — 항상 최신 뉴스 조회
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url 필요' });
  try {
    const r = await fetch(decodeURIComponent(url), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      }
    });
    if (!r.ok) return res.status(r.status).json({ error: `RSS 응답 오류: ${r.status}` });
    const text = await r.text();
    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    res.status(200).send(text);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
