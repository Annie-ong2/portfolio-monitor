// Vercel 서버리스 함수 — 야후 파이낸스 프록시
export default async function handler(req, res) {
  // CORS 허용
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { symbol } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: 'symbol 파라미터가 필요해요' });
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: '야후 파이낸스 요청 실패' });
    }

    const data = await response.json();
    const meta = data.chart.result[0].meta;

    return res.status(200).json({
      symbol,
      price:      meta.regularMarketPrice,
      prevClose:  meta.chartPreviousClose || meta.previousClose,
      change:     meta.regularMarketPrice - (meta.chartPreviousClose || meta.previousClose),
      changePct:  ((meta.regularMarketPrice - (meta.chartPreviousClose || meta.previousClose)) / (meta.chartPreviousClose || meta.previousClose)) * 100,
      high52:     meta.fiftyTwoWeekHigh,
      low52:      meta.fiftyTwoWeekLow,
      volume:     meta.regularMarketVolume,
      prePrice:   meta.preMarketPrice || null,
      postPrice:  meta.postMarketPrice || null,
      currency:   meta.currency,
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
