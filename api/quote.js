export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol 필요' });
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const d = await r.json();
    const m = d.chart.result[0].meta;
    const prev = m.chartPreviousClose || m.previousClose;
    res.status(200).json({
      price: m.regularMarketPrice,
      prevClose: prev,
      change: m.regularMarketPrice - prev,
      changePct: ((m.regularMarketPrice - prev) / prev) * 100,
      high52: m.fiftyTwoWeekHigh,
      low52: m.fiftyTwoWeekLow,
      volume: m.regularMarketVolume,
      prePrice: m.preMarketPrice || null,
      postPrice: m.postMarketPrice || null,
      currency: m.currency,
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
