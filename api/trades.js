// 한국투자증권 체결내역 + 실현손익
// 기존 체결내역(API 신청 이전)은 하드코딩, 이후 발생분은 API 실시간 조회 후 합산

const KIS_BASE   = 'https://openapi.koreainvestment.com:9443';
const API_START  = '20260618'; // APP KEY 발급일 — 이후 체결만 API로 조회

// ── 하드코딩된 기존 체결내역 (APP KEY 발급 이전 거래)
const PRIOR_TRADES = [
  // 마이크론 매수 (2026.06.02)
  { market:'US', symbol:'MU', name:'마이크론 테크놀로지', date:'20260602', side:'BUY',  qty:20, price:1040.5953 },
  // 마이크론 매수 추가 (2026.06.04)
  { market:'US', symbol:'MU', name:'마이크론 테크놀로지', date:'20260604', side:'BUY',  qty:10, price:1040.5953 },
  // 마이크론 1차 익절 (2026.06.16)
  { market:'US', symbol:'MU', name:'마이크론 테크놀로지', date:'20260616', side:'SELL', qty:10, price:1100.01 },
  // 삼성전자 매수 (2026.06.04)
  { market:'KR', symbol:'005930', name:'삼성전자', date:'20260604', side:'BUY', qty:70, price:349500 },
];

const _cache = {
  1: { token: null, expiry: 0 },
  2: { token: null, expiry: 0 },
};

async function getToken(appKey, appSecret, cacheKey) {
  const now = Date.now();
  const cache = _cache[cacheKey];
  if (cache.token && now < cache.expiry - 5 * 60 * 1000) return cache.token;
  const res  = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: appKey, appsecret: appSecret }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('토큰 발급 실패');
  cache.token  = data.access_token;
  cache.expiry = now + (data.expires_in ? data.expires_in * 1000 : 86400 * 1000);
  return cache.token;
}

function parseAccount(accountNo) {
  if (!accountNo) return ['', '01'];
  const clean = accountNo.trim().replace(/-/g, '');
  if (clean.length === 8)  return [clean, '01'];
  if (clean.length >= 10)  return [clean.slice(0,8), clean.slice(8)];
  return [clean, '01'];
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

// ── 국내주식 체결내역 (API_START 이후)
async function getDomesticTrades(token, appKey, appSecret, accountNo) {
  const [acctNum, acctSuffix] = parseAccount(accountNo);
  const errors = [];

  for (const trId of ['TTTC8001R', 'TTTC8908R', 'CTSC9115R']) {
    const trades = [];
    let ctxFk = '', ctxNk = '';
    let success = false;

    for (let page = 0; page < 5; page++) {
      const body = {
        CANO: acctNum, ACNT_PRDT_CD: acctSuffix || '01',
        INQR_STRT_DT: API_START, INQR_END_DT: todayStr(),
        SLL_BUY_DVSN_CD: '00', INQR_DVSN: '00', PDNO: '',
        CCLD_DVSN: '01', ORD_GNO_BRNO: '', ODNO: '',
        INQR_DVSN_3: '00', INQR_DVSN_1: '',
        CTX_AREA_FK100: ctxFk, CTX_AREA_NK100: ctxNk,
      };

      const res = await fetch(`${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-daily-ccld`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'authorization': `Bearer ${token}`,
          'appkey': appKey, 'appsecret': appSecret, 'tr_id': trId, 'custtype': 'P',
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.rt_cd !== '0') { errors.push(`${trId}: ${data.msg1}`); break; }

      success = true;
      (data.output1 || []).forEach(t => {
        const qty = parseInt(t.tot_ccld_qty || 0);
        if (!t.pdno || qty === 0) return;
        trades.push({
          market: 'KR', symbol: t.pdno, name: t.prdt_name,
          date: t.ord_dt, side: t.sll_buy_dvsn_cd === '01' ? 'SELL' : 'BUY',
          qty, price: parseFloat(t.avg_prvs || 0),
          amount: parseFloat(t.tot_ccld_amt || 0),
          source: 'api',
        });
      });

      if (data.tr_cont === 'D' || data.tr_cont === 'E' || !data.tr_cont) break;
      ctxFk = data.ctx_area_fk100 || ''; ctxNk = data.ctx_area_nk100 || '';
      if (!ctxFk && !ctxNk) break;
    }
    if (success) return { trades, errors };
  }
  return { trades: [], errors };
}

// ── 해외주식 체결내역 (API_START 이후)
async function getOverseasTrades(token, appKey, appSecret, accountNo) {
  const [acctNum, acctSuffix] = parseAccount(accountNo);
  const trades = [];
  const errors = [];
  const today  = todayStr();

  for (const excd of ['NASD', 'NYSE', 'AMEX']) {
    if (excd !== 'NASD') await new Promise(r => setTimeout(r, 400));
    try {
      const params = new URLSearchParams({
        CANO: acctNum, ACNT_PRDT_CD: acctSuffix || '01',
        PDNO: '', INQR_STRT_DT: API_START, INQR_END_DT: today,
        SLL_BUY_DVSN_CD: '00', CCLD_NCCS_DVSN: '00',
        OVRS_EXCG_CD: excd, SORT_SQN: 'DS',
        CTX_AREA_FK200: '', CTX_AREA_NK200: '',
      });

      const res = await fetch(`${KIS_BASE}/uapi/overseas-stock/v1/trading/inquire-ccnl?${params}`, {
        headers: {
          'Content-Type': 'application/json', 'authorization': `Bearer ${token}`,
          'appkey': appKey, 'appsecret': appSecret, 'tr_id': 'TTTS3035R', 'custtype': 'P',
        },
      });
      const data = await res.json();
      if (data.rt_cd !== '0') { errors.push(`${excd}: ${data.msg1}`); continue; }

      const output = data.output1 || data.output || [];
      output.forEach(t => {
        const qty = parseFloat(t.ft_ccld_qty || 0);
        if (!t.pdno || qty === 0) return;
        trades.push({
          market: 'US', exchange: excd, symbol: t.pdno, name: t.prdt_name || '',
          date: t.ord_dt || '', side: t.sll_buy_dvsn_cd === '01' ? 'SELL' : 'BUY',
          qty, price: parseFloat(t.ft_ccld_unpr3 || 0),
          amount: parseFloat(t.ft_ccld_amt3 || 0),
          source: 'api',
        });
      });
    } catch(e) { errors.push(`${excd}: ${e.message}`); }
  }
  return { trades, errors };
}

// ── 실현손익 계산 (하드코딩 + API 합산)
function calcRealizedPnL(allTrades, symbol, avgBuyPrice) {
  const sells = allTrades.filter(t => t.symbol === symbol && t.side === 'SELL');
  let realizedPnL = 0, soldQty = 0;
  sells.forEach(t => {
    realizedPnL += (t.price - avgBuyPrice) * t.qty;
    soldQty += t.qty;
  });
  return { realizedPnL, soldQty };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const acc1 = { key: process.env.KIS_APP_KEY,  secret: process.env.KIS_APP_SECRET,  account: process.env.KIS_ACCOUNT_NO  };
  const acc2 = { key: process.env.KIS_APP_KEY2, secret: process.env.KIS_APP_SECRET2, account: process.env.KIS_ACCOUNT_NO2 };

  if (!acc1.key) return res.status(500).json({ error: 'KIS 환경변수 미설정' });

  try {
    const [t1, t2] = await Promise.allSettled([
      getToken(acc1.key, acc1.secret, 1),
      acc2.key ? getToken(acc2.key, acc2.secret, 2) : Promise.resolve(null),
    ]);
    const token1 = t1.status === 'fulfilled' ? t1.value : null;
    const token2 = t2.status === 'fulfilled' ? t2.value : null;

    // API로 신규 체결내역 조회
    const [oResult, dResult] = await Promise.allSettled([
      token1 ? getOverseasTrades(token1, acc1.key, acc1.secret, acc1.account) : Promise.resolve({ trades:[], errors:[] }),
      token2 && acc2.account ? getDomesticTrades(token2, acc2.key, acc2.secret, acc2.account) : Promise.resolve({ trades:[], errors:[] }),
    ]);

    const apiOTrades = oResult.status === 'fulfilled' ? oResult.value.trades : [];
    const apiDTrades = dResult.status === 'fulfilled' ? dResult.value.trades : [];
    const oErrors    = oResult.status === 'fulfilled' ? oResult.value.errors : [];
    const dErrors    = dResult.status === 'fulfilled' ? dResult.value.errors : [];

    // 하드코딩 + API 체결내역 합산 (날짜순 정렬)
    const allOTrades = [...PRIOR_TRADES.filter(t => t.market === 'US'), ...apiOTrades]
      .sort((a,b) => a.date.localeCompare(b.date));
    const allDTrades = [...PRIOR_TRADES.filter(t => t.market === 'KR'), ...apiDTrades]
      .sort((a,b) => a.date.localeCompare(b.date));

    return res.status(200).json({
      trades:   [...allDTrades, ...allOTrades],
      realized: {
        samsung: calcRealizedPnL(allDTrades, '005930', 349500),
        micron:  calcRealizedPnL(allOTrades, 'MU',     1040.5953),
      },
      debug: {
        priorTrades:   PRIOR_TRADES.length,
        apiOTrades:    apiOTrades.length,
        apiDTrades:    apiDTrades.length,
        oErrors,
        dErrors,
      },
      timestamp: Date.now(),
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
