export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url 필요' });
  try {
    const r = await fetch(decodeURIComponent(url), {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const text = await r.text();
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(text);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
