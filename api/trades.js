// 한국투자증권 체결내역 + 실현손익
// 삼성전자: TTTC8715R 기간별 실현손익 API (sll_qty>0 체크)
// 마이크론: PRIOR_TRADES 기반 폴백 (TTTS3250R 빈응답으로 사용불가)
// 당일 체결: 국내/해외 당일 API 실시간 반영

const KIS_BASE   = 'https://openapi.koreainvestment.com:9443';
const START_DATE = '20260602';

// 기존 체결내역 (표시용 + 마이크론 실현손익 계산용)
const PRIOR_TRADES = [
  { market:'US', symbol:'MU', name:'마이크론 테크놀로지', date:'20260602', side:'BUY',  qty:20, price:1040.5953 },
  { market:'US', symbol:'MU', name:'마이크론 테크놀로지', date:'20260604', side:'BUY',  qty:10, price:1040.5953 },
  { market:'US', symbol:'MU', name:'마이크론 테크놀로지', date:'20260616', side:'SELL', qty:10, price:1100.01   },
  { market:'KR', symbol:'005930', name:'삼성전자',        date:'20260604', side:'BUY',  qty:70, price:349500    },
];

const _cache = { 1:{token:null,expiry:0}, 2:{token:null,expiry:0} };

async function getToken(appKey, appSecret, cacheKey) {
  const now = Date.now(), cache = _cache[cacheKey];
  if (cache.token && now < cache.expiry - 5*60*1000) return cache.token;
  const res  = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ grant_type:'client_credentials', appkey:appKey, appsecret:appSecret }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('토큰 발급 실패');
  cache.token  = data.access_token;
  cache.expiry = now + (data.expires_in ? data.expires_in*1000 : 86400*1000);
  return cache.token;
}

function parseAccount(accountNo) {
  if (!accountNo) return ['','01'];
  const clean = accountNo.trim().replace(/-/g,'');
  if (clean.length === 8)  return [clean,'01'];
  if (clean.length >= 10)  return [clean.slice(0,8), clean.slice(8)];
  return [clean,'01'];
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

// ── 국내주식 기간별 실현손익 (TTTC8715R)
// sll_qty > 0 인 경우만 실현손익 인정 (수수료만 있는 경우 제외)
async function getDomesticRealizedPnL(token, appKey, appSecret, accountNo) {
  const [acctNum, acctSuffix] = parseAccount(accountNo);
  const params = new URLSearchParams({
    CANO: acctNum, ACNT_PRDT_CD: acctSuffix || '01',
    SORT_DVSN: '00', PDNO: '',
    INQR_STRT_DT: START_DATE, INQR_END_DT: todayStr(),
    CBLC_DVSN: '00',
    CTX_AREA_FK100: '', CTX_AREA_NK100: '',
  });
  const res  = await fetch(`${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-period-trade-profit?${params}`, {
    headers: {
      'Content-Type':'application/json', 'authorization':`Bearer ${token}`,
      'appkey':appKey, 'appsecret':appSecret, 'tr_id':'TTTC8715R', 'custtype':'P',
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch(e) { return { pnl:0, error:`JSON파싱오류: ${text.slice(0,80)}` }; }
  if (data.rt_cd !== '0') return { pnl:0, error:`TTTC8715R: ${data.msg1}` };

  const items = data.output1 || [];
  let totalPnL = 0;
  items.forEach(t => {
    if (t.pdno === '005930' && parseInt(t.sll_qty || 0) > 0) {
      totalPnL += parseFloat(t.rlzt_pfls || 0);
    }
  });
  return { pnl: totalPnL, error: null };
}

// ── 마이크론 실현손익: PRIOR_TRADES 기반 계산
// (TTTS3250R API 빈응답으로 사용불가 → 당일 매도는 oTodayTrades로 추가 반영)
function calcMicronRealizedPnL(todayTrades) {
  const allSells = [
    ...PRIOR_TRADES.filter(t => t.symbol === 'MU' && t.side === 'SELL'),
    ...todayTrades.filter(t => t.symbol === 'MU' && t.side === 'SELL'),
  ];
  return allSells.reduce((sum, t) => sum + (t.price - 1040.5953) * t.qty, 0);
}

// ── 당일 국내주식 체결내역
async function getDomesticTodayTrades(token, appKey, appSecret, accountNo) {
  const [acctNum, acctSuffix] = parseAccount(accountNo);
  const today = todayStr();
  for (const trId of ['TTTC8001R','TTTC8908R','CTSC9115R']) {
    const res  = await fetch(`${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-daily-ccld`, {
      method:'POST',
      headers: { 'Content-Type':'application/json','authorization':`Bearer ${token}`,'appkey':appKey,'appsecret':appSecret,'tr_id':trId,'custtype':'P' },
      body: JSON.stringify({
        CANO:acctNum, ACNT_PRDT_CD:acctSuffix||'01',
        INQR_STRT_DT:today, INQR_END_DT:today,
        SLL_BUY_DVSN_CD:'00', INQR_DVSN:'00', PDNO:'',
        CCLD_DVSN:'01', ORD_GNO_BRNO:'', ODNO:'',
        INQR_DVSN_3:'00', INQR_DVSN_1:'',
        CTX_AREA_FK100:'', CTX_AREA_NK100:'',
      }),
    });
    const data = await res.json();
    if (data.rt_cd !== '0') continue;
    return (data.output1||[]).filter(t=>parseInt(t.tot_ccld_qty||0)>0).map(t=>({
      market:'KR', symbol:t.pdno, name:t.prdt_name,
      date:t.ord_dt, side:t.sll_buy_dvsn_cd==='01'?'SELL':'BUY',
      qty:parseInt(t.tot_ccld_qty||0), price:parseFloat(t.avg_prvs||0), source:'api_today',
    }));
  }
  return [];
}

// ── 당일 해외주식 체결내역
async function getOverseasTodayTrades(token, appKey, appSecret, accountNo) {
  const [acctNum, acctSuffix] = parseAccount(accountNo);
  const today = todayStr();
  const trades = [];
  for (const excd of ['NASD','NYSE','AMEX']) {
    if (excd!=='NASD') await new Promise(r=>setTimeout(r,400));
    try {
      const params = new URLSearchParams({
        CANO:acctNum, ACNT_PRDT_CD:acctSuffix||'01',
        PDNO:'', INQR_STRT_DT:today, INQR_END_DT:today,
        SLL_BUY_DVSN_CD:'00', CCLD_NCCS_DVSN:'00',
        OVRS_EXCG_CD:excd, SORT_SQN:'DS',
        CTX_AREA_FK200:'', CTX_AREA_NK200:'',
      });
      const res  = await fetch(`${KIS_BASE}/uapi/overseas-stock/v1/trading/inquire-ccnl?${params}`, {
        headers: { 'Content-Type':'application/json','authorization':`Bearer ${token}`,'appkey':appKey,'appsecret':appSecret,'tr_id':'TTTS3035R','custtype':'P' },
      });
      const data = await res.json();
      if (data.rt_cd!=='0') continue;
      (data.output1||data.output||[]).forEach(t=>{
        const qty = parseFloat(t.ft_ccld_qty||0);
        if (!t.pdno||qty===0) return;
        trades.push({ market:'US', exchange:excd, symbol:t.pdno, name:t.prdt_name||'',
          date:t.ord_dt||today, side:t.sll_buy_dvsn_cd==='01'?'SELL':'BUY',
          qty, price:parseFloat(t.ft_ccld_unpr3||0), source:'api_today' });
      });
    } catch(e) {}
  }
  return trades;
}

function mergeTrades(trades) {
  const seen = new Set();
  return trades.filter(t=>{
    const key=`${t.date}-${t.symbol}-${t.side}-${t.qty}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a,b)=>a.date.localeCompare(b.date));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=60, stale-while-revalidate');

  const acc1 = { key:process.env.KIS_APP_KEY,  secret:process.env.KIS_APP_SECRET,  account:process.env.KIS_ACCOUNT_NO  };
  const acc2 = { key:process.env.KIS_APP_KEY2, secret:process.env.KIS_APP_SECRET2, account:process.env.KIS_ACCOUNT_NO2 };
  if (!acc1.key) return res.status(500).json({ error:'KIS 환경변수 미설정' });

  try {
    const [t1, t2] = await Promise.allSettled([
      getToken(acc1.key, acc1.secret, 1),
      acc2.key ? getToken(acc2.key, acc2.secret, 2) : Promise.resolve(null),
    ]);
    const token1 = t1.status==='fulfilled' ? t1.value : null;
    const token2 = t2.status==='fulfilled' ? t2.value : null;

    const [dRzdR, oTodayR, dTodayR] = await Promise.allSettled([
      token2 && acc2.account
        ? getDomesticRealizedPnL(token2, acc2.key, acc2.secret, acc2.account)
        : Promise.resolve({ pnl:0, error:'토큰없음' }),
      token1 ? getOverseasTodayTrades(token1, acc1.key, acc1.secret, acc1.account) : Promise.resolve([]),
      token2 && acc2.account ? getDomesticTodayTrades(token2, acc2.key, acc2.secret, acc2.account) : Promise.resolve([]),
    ]);

    const dRzd   = dRzdR.status==='fulfilled'   ? dRzdR.value   : { pnl:0, error:dRzdR.reason?.message };
    const oToday = oTodayR.status==='fulfilled'  ? oTodayR.value : [];
    const dToday = dTodayR.status==='fulfilled'  ? dTodayR.value : [];

    // 삼성전자: API 실현손익 (오류 시 0)
    const samsungPnL = dRzd.error ? 0 : dRzd.pnl;

    // 마이크론: PRIOR_TRADES + 당일 매도 합산
    const micronPnL = calcMicronRealizedPnL(oToday);

    const allOTrades = mergeTrades([...PRIOR_TRADES.filter(t=>t.market==='US'), ...oToday]);
    const allDTrades = mergeTrades([...PRIOR_TRADES.filter(t=>t.market==='KR'), ...dToday]);

    return res.status(200).json({
      trades: [...allDTrades, ...allOTrades],
      realized: {
        samsung: { realizedPnL: samsungPnL, source: dRzd.error ? 'none' : 'api' },
        micron:  { realizedPnL: micronPnL,  source: oToday.some(t=>t.symbol==='MU'&&t.side==='SELL') ? 'api+prior' : 'prior' },
      },
      debug: {
        dRzdError:   dRzd.error  || null,
        oTodayCount: oToday.length,
        dTodayCount: dToday.length,
      },
      timestamp: Date.now(),
    });
  } catch(e) {
    return res.status(500).json({ error:e.message });
  }
}
