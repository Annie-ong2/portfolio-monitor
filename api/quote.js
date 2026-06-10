// Vercel 서버리스 함수 — 야후 파이낸스 프록시
// 시세(1d)와 히스토리(1y)를 분리 호출하여 전일비 오류 방지
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { symbol, history } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol 필요' });

  const cleanSymbol  = decodeURIComponent(symbol);
  const needHistory  = history === 'true';
  const HEADERS = {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept':          'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer':         'https://finance.yahoo.com/',
  };

  try {
    // ── 1. 당일 시세 (항상 1d로 요청 → 전일비 정확)
    const quoteUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanSymbol)}?interval=1d&range=1d`;
    const quoteRes = await fetch(quoteUrl, { headers: HEADERS });
    if (!quoteRes.ok) return res.status(quoteRes.status).json({ error: `야후 응답 오류: ${quoteRes.status}` });

    const quoteData = await quoteRes.json();
    if (!quoteData.chart?.result?.[0]) return res.status(404).json({ error: '종목 데이터 없음' });

    const meta = quoteData.chart.result[0].meta;
    const prev = meta.chartPreviousClose || meta.previousClose || meta.regularMarketPrice;

    const base = {
      symbol:               cleanSymbol,
      price:                meta.regularMarketPrice,
      prevClose:            prev,
      change:               meta.regularMarketPrice - prev,
      changePct:            ((meta.regularMarketPrice - prev) / prev) * 100,
      high52:               meta.fiftyTwoWeekHigh,
      low52:                meta.fiftyTwoWeekLow,
      volume:               meta.regularMarketVolume,
      prePrice:             meta.preMarketPrice  || null,
      postPrice:            meta.postMarketPrice || null,
      currency:             meta.currency,
      marketTime:           meta.regularMarketTime || null,
      exchangeTimezoneName: meta.exchangeTimezoneName || null,
    };

    // ── 2. 1년 히스토리 (별도 요청 — 시세에 영향 없음)
    if (needHistory) {
      try {
        const histUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanSymbol)}?interval=1d&range=1y`;
        const histRes = await fetch(histUrl, { headers: HEADERS });
        if (histRes.ok) {
          const histData = await histRes.json();
          const result   = histData.chart?.result?.[0];
          if (result?.timestamp && result?.indicators?.quote?.[0]?.close) {
            const timestamps = result.timestamp;
            const closes     = result.indicators.quote[0].close;
            base.history = timestamps.map((t, i) => ({
              t: t,
              c: closes[i],
            })).filter(d => d.c !== null && d.c !== undefined);
          }
        }
      } catch(e) {
        // 히스토리 실패해도 시세는 정상 반환
        base.history = [];
      }
    }

    return res.status(200).json(base);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
