// Vercel 서버리스 함수 — 야후 파이낸스 프록시 (시세 + 1년 히스토리)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { symbol, history } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol 필요' });

  const cleanSymbol = decodeURIComponent(symbol);
  const needHistory = history === 'true';

  // 히스토리 필요 시 1년치, 아니면 당일
  const range    = needHistory ? '1y' : '1d';
  const interval = needHistory ? '1d' : '1d';

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanSymbol)}?interval=${interval}&range=${range}`;
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

    const result = data.chart.result[0];
    const meta   = result.meta;
    const prev   = meta.chartPreviousClose || meta.previousClose || meta.regularMarketPrice;

    const base = {
      symbol:      cleanSymbol,
      price:       meta.regularMarketPrice,
      prevClose:   prev,
      change:      meta.regularMarketPrice - prev,
      changePct:   ((meta.regularMarketPrice - prev) / prev) * 100,
      high52:      meta.fiftyTwoWeekHigh,
      low52:       meta.fiftyTwoWeekLow,
      volume:      meta.regularMarketVolume,
      prePrice:    meta.preMarketPrice  || null,
      postPrice:   meta.postMarketPrice || null,
      currency:    meta.currency,
      marketTime:  meta.regularMarketTime || null,
      exchangeTimezoneName: meta.exchangeTimezoneName || null,
    };

    // 1년치 히스토리 포함
    if (needHistory && result.timestamp && result.indicators?.quote?.[0]?.close) {
      const timestamps = result.timestamp;
      const closes     = result.indicators.quote[0].close;
      base.history = timestamps.map((t, i) => ({
        t: t,          // Unix timestamp (초)
        c: closes[i],  // 종가
      })).filter(d => d.c !== null && d.c !== undefined);
    }

    return res.status(200).json(base);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
