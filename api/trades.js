// 한국투자증권 체결내역 + 실현손익
// 실현손익: KIS 기간별손익 API (TTTC8715R 국내 / TTTS3250R 해외)
// 체결내역: 당일 API + PRIOR_TRADES 하드코딩 합산

const KIS_BASE   = 'https://openapi.koreainvestment.com:9443';
const START_DATE = '20260602'; // 최초 매수일

// ── 하드코딩 체결내역 (API 신청 이전 거래 — 표시용)
const PRIOR_TRADES = [
  { market:'US', symbol:'MU', name:'마이크론 테크놀로지', date:'20260602', side:'BUY',  qty:20, price:1040.5953 },
  { market:'US', symbol:'MU', name:'마이크론 테크놀로지', date:'20260604', side:'BUY',  qty:10, price:1040.5953 },
  { market:'US', symbol:'MU', name:'마이크론 테크놀로지', date:'20260616', side:'SELL', qty:10, price:1100.01   },
  { market:'KR', symbol:'005930', name:'삼성전자',        date:'20260604', side:'BUY',  qty:70, price:349500    },
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

// ── 국내주식 기간별 실현손익 (TTTC8715R)
async function getDomesticRealizedPnL(token, appKey, appSecret, accountNo) {
  const [acctNum, acctSuffix] = parseAccount(accountNo);
  const params = new URLSearchParams({
    CANO:            acctNum,
    ACNT_PRDT_CD:    acctSuffix || '01',
    SORT_DVSN:       '00',
    PDNO:            '',
    INQR_STRT_DT:   START_DATE,
    INQR_END_DT:    todayStr(),
    CBLC_DVSN:      '00',
    CTX_AREA_FK100:  '',
    CTX_AREA_NK100:  '',
  });

  const res  = await fetch(`${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-period-trade-profit?${params}`, {
    headers: {
      'Content-Type': 'application/json', 'authorization': `Bearer ${token}`,
      'appkey': appKey, 'appsecret': appSecret, 'tr_id': 'TTTC8715R', 'custtype': 'P',
    },
  });
  const data = await res.json();
  if (data.rt_cd !== '0') return { pnl: 0, trades: [], error: `TTTC8715R: ${data.msg1}` };

  // output1: 종목별 손익 / output2: 합계
  const items = (data.output1 || []);
  const samsung = items.find(t => t.pdno === '005930');
  const totalPnL = samsung ? parseFloat(samsung.rlzt_pfls || 0) : 0; // 실현손익

  // 체결내역 형태로 변환
  const trades = items.filter(t => t.pdno === '005930' && parseFloat(t.sll_qty || 0) > 0).map(t => ({
    market: 'KR', symbol: t.pdno, name: t.prdt_name,
    date: t.trad_dt || todayStr(),
    side: 'SELL',
    qty: parseFloat(t.sll_qty || 0),
    price: parseFloat(t.sll_amt || 0) / parseFloat(t.sll_qty || 1),
    source: 'api',
  }));

  return { pnl: totalPnL, trades, error: null };
}

// ── 해외주식 기간별 실현손익 (TTTS3250R)
async function getOverseasRealizedPnL(token, appKey, appSecret, accountNo) {
  const [acctNum, acctSuffix] = parseAccount(accountNo);
  const params = new URLSearchParams({
    CANO:            acctNum,
    ACNT_PRDT_CD:    acctSuffix || '01',
    INQR_STRT_DT:   START_DATE,
    INQR_END_DT:    todayStr(),
    WCRC_FRCR_DVSN_CD: '02', // 외화(USD)
    NATN_CD:         '840',  // 미국
    TR_MKET_CD:      '00',   // 전체
    INQR_DVSN_CD:    '00',
    CTX_AREA_FK200:  '',
    CTX_AREA_NK200:  '',
  });

  const res  = await fetch(`${KIS_BASE}/uapi/overseas-stock/v1/trading/inquire-period-trade-profit?${params}`, {
    headers: {
      'Content-Type': 'application/json', 'authorization': `Bearer ${token}`,
      'appkey': appKey, 'appsecret': appSecret, 'tr_id': 'TTTS3250R', 'custtype': 'P',
    },
  });
  const data = await res.json();
  if (data.rt_cd !== '0') return { pnl: 0, trades: [], error: `TTTS3250R: ${data.msg1}` };

  const items = (data.output1 || []);
  const micron = items.find(t => t.pdno === 'MU');
  const totalPnL = micron ? parseFloat(micron.rlzt_pfls || 0) : 0;

  const trades = items.filter(t => t.pdno === 'MU' && parseFloat(t.sll_qty || 0) > 0).map(t => ({
    market: 'US', symbol: t.pdno, name: t.prdt_name || '마이크론 테크놀로지',
    date: t.trad_dt || todayStr(),
    side: 'SELL',
    qty: parseFloat(t.sll_qty || 0),
    price: parseFloat(t.sll_amt || 0) / parseFloat(t.sll_qty || 1),
    source: 'api',
  }));

  return { pnl: totalPnL, trades, error: null };
}

// ── 당일 국내주식 체결내역 (오늘 매도 실시간 반영용)
async function getDomesticTodayTrades(token, appKey, appSecret, accountNo) {
  const [acctNum, acctSuffix] = parseAccount(accountNo);
  const today = todayStr();
  const errors = [];

  for (const trId of ['TTTC8001R', 'TTTC8908R', 'CTSC9115R']) {
    const body = {
      CANO: acctNum, ACNT_PRDT_CD: acctSuffix || '01',
      INQR_STRT_DT: today, INQR_END_DT: today,
      SLL_BUY_DVSN_CD: '00', INQR_DVSN: '00', PDNO: '',
      CCLD_DVSN: '01', ORD_GNO_BRNO: '', ODNO: '',
      INQR_DVSN_3: '00', INQR_DVSN_1: '',
      CTX_AREA_FK100: '', CTX_AREA_NK100: '',
    };
    const res  = await fetch(`${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-daily-ccld`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'authorization': `Bearer ${token}`,
        'appkey': appKey, 'appsecret': appSecret, 'tr_id': trId, 'custtype': 'P',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.rt_cd !== '0') { errors.push(`${trId}: ${data.msg1}`); continue; }

    return {
      trades: (data.output1 || []).filter(t => parseInt(t.tot_ccld_qty||0) > 0).map(t => ({
        market: 'KR', symbol: t.pdno, name: t.prdt_name,
        date: t.ord_dt, side: t.sll_buy_dvsn_cd === '01' ? 'SELL' : 'BUY',
        qty: parseInt(t.tot_ccld_qty || 0),
        price: parseFloat(t.avg_prvs || 0),
        source: 'api_today',
      })),
      errors,
    };
  }
  return { trades: [], errors };
}

// ── 해외주식 당일 체결내역
async function getOverseasTodayTrades(token, appKey, appSecret, accountNo) {
  const [acctNum, acctSuffix] = parseAccount(accountNo);
  const today = todayStr();
  const trades = [];
  const errors = [];

  for (const excd of ['NASD', 'NYSE', 'AMEX']) {
    if (excd !== 'NASD') await new Promise(r => setTimeout(r, 400));
    const params = new URLSearchParams({
      CANO: acctNum, ACNT_PRDT_CD: acctSuffix || '01',
      PDNO: '', INQR_STRT_DT: today, INQR_END_DT: today,
      SLL_BUY_DVSN_CD: '00', CCLD_NCCS_DVSN: '00',
      OVRS_EXCG_CD: excd, SORT_SQN: 'DS',
      CTX_AREA_FK200: '', CTX_AREA_NK200: '',
    });
    try {
      const res  = await fetch(`${KIS_BASE}/uapi/overseas-stock/v1/trading/inquire-ccnl?${params}`, {
        headers: {
          'Content-Type': 'application/json', 'authorization': `Bearer ${token}`,
          'appkey': appKey, 'appsecret': appSecret, 'tr_id': 'TTTS3035R', 'custtype': 'P',
        },
      });
      const data = await res.json();
      if (data.rt_cd !== '0') { errors.push(`${excd}: ${data.msg1}`); continue; }
      (data.output1 || data.output || []).forEach(t => {
        const qty = parseFloat(t.ft_ccld_qty || 0);
        if (!t.pdno || qty === 0) return;
        trades.push({
          market: 'US', exchange: excd, symbol: t.pdno, name: t.prdt_name || '',
          date: t.ord_dt || today, side: t.sll_buy_dvsn_cd === '01' ? 'SELL' : 'BUY',
          qty, price: parseFloat(t.ft_ccld_unpr3 || 0), source: 'api_today',
        });
      });
    } catch(e) { errors.push(`${excd}: ${e.message}`); }
  }
  return { trades, errors };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');

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

    // 모든 조회 병렬 실행
    const [
      overseasPnLResult,
      domesticPnLResult,
      overseasTodayResult,
      domesticTodayResult,
    ] = await Promise.allSettled([
      token1 ? getOverseasRealizedPnL(token1, acc1.key, acc1.secret, acc1.account)    : Promise.resolve({ pnl:0, trades:[], error:'토큰없음' }),
      token2 && acc2.account ? getDomesticRealizedPnL(token2, acc2.key, acc2.secret, acc2.account) : Promise.resolve({ pnl:0, trades:[], error:'토큰없음' }),
      token1 ? getOverseasTodayTrades(token1, acc1.key, acc1.secret, acc1.account)    : Promise.resolve({ trades:[], errors:[] }),
      token2 && acc2.account ? getDomesticTodayTrades(token2, acc2.key, acc2.secret, acc2.account) : Promise.resolve({ trades:[], errors:[] }),
    ]);

    const oRzd  = overseasPnLResult.status  === 'fulfilled' ? overseasPnLResult.value  : { pnl:0, trades:[], error: overseasPnLResult.reason?.message };
    const dRzd  = domesticPnLResult.status  === 'fulfilled' ? domesticPnLResult.value  : { pnl:0, trades:[], error: domesticPnLResult.reason?.message };
    const oToday = overseasTodayResult.status === 'fulfilled' ? overseasTodayResult.value.trades : [];
    const dToday = domesticTodayResult.status === 'fulfilled' ? domesticTodayResult.value.trades : [];

    // 실현손익: API 기간별 손익 우선, 오류 시 PRIOR_TRADES로 폴백
    const micronPnL  = oRzd.error ? calcFallback(PRIOR_TRADES.filter(t=>t.market==='US'), 'MU',     1040.5953) : oRzd.pnl;
    const samsungPnL = dRzd.error ? calcFallback(PRIOR_TRADES.filter(t=>t.market==='KR'), '005930', 349500)    : dRzd.pnl;

    // 체결내역: PRIOR_TRADES + 당일 API 합산 (중복 제거)
    const allOTrades = mergeTrades([...PRIOR_TRADES.filter(t=>t.market==='US'), ...oToday]);
    const allDTrades = mergeTrades([...PRIOR_TRADES.filter(t=>t.market==='KR'), ...dToday]);

    return res.status(200).json({
      trades: [...allDTrades, ...allOTrades],
      realized: {
        samsung: { realizedPnL: samsungPnL, source: dRzd.error ? 'fallback' : 'api' },
        micron:  { realizedPnL: micronPnL,  source: oRzd.error ? 'fallback' : 'api' },
      },
      debug: {
        oRzdError:    oRzd.error,
        dRzdError:    dRzd.error,
        oTodayCount:  oToday.length,
        dTodayCount:  dToday.length,
      },
      timestamp: Date.now(),
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

// ── 폴백: PRIOR_TRADES 기반 실현손익 계산
function calcFallback(trades, symbol, avgBuyPrice) {
  const sells = trades.filter(t => t.symbol === symbol && t.side === 'SELL');
  return sells.reduce((sum, t) => sum + (t.price - avgBuyPrice) * t.qty, 0);
}

// ── 중복 체결내역 제거 (같은 날짜+심볼+side+qty)
function mergeTrades(trades) {
  const seen = new Set();
  return trades.filter(t => {
    const key = `${t.date}-${t.symbol}-${t.side}-${t.qty}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a,b) => a.date.localeCompare(b.date));
}
