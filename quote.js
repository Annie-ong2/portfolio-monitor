// Vercel 서버리스 함수 — 야후 파이낸스 프록시
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol 필요' });

  // ^ 기호가 있는 지수 심볼 처리 (%5E로 들어올 수 있음)
  const cleanSymbol = decodeURIComponent(symbol);

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanSymbol)}?interval=1d&range=1d`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://finance.yahoo.com/',
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `야후 응답 오류: ${response.status}` });
    }

    const data = await response.json();
    if (!data.chart?.result?.[0]) {
      return res.status(404).json({ error: '종목 데이터 없음' });
    }

    const meta = data.chart.result[0].meta;
    const prev = meta.chartPreviousClose || meta.previousClose || meta.regularMarketPrice;

    return res.status(200).json({
      symbol: cleanSymbol,
      price:     meta.regularMarketPrice,
      prevClose: prev,
      change:    meta.regularMarketPrice - prev,
      changePct: ((meta.regularMarketPrice - prev) / prev) * 100,
      high52:    meta.fiftyTwoWeekHigh,
      low52:     meta.fiftyTwoWeekLow,
      volume:    meta.regularMarketVolume,
      prePrice:  meta.preMarketPrice  || null,
      postPrice: meta.postMarketPrice || null,
      currency:  meta.currency,
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
