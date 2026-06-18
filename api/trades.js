// 한국투자증권 체결내역 + 실현손익 조회
// 공식 문서 기반: TTTC8001R(국내 POST), TTTS3035R(해외 GET)

const KIS_BASE   = 'https://openapi.koreainvestment.com:9443';
const START_DATE = '20260602';

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
  if (!data.access_token) throw new Error('토큰 발급 실패: ' + JSON.stringify(data));
  cache.token  = data.access_token;
  cache.expiry = now + (data.expires_in ? data.expires_in * 1000 : 86400 * 1000);
  return cache.token;
}

function parseAccount(accountNo) {
  if (!accountNo) return ['', '01'];
  if (accountNo.includes('-')) return accountNo.split('-');
  if (accountNo.length >= 10)  return [accountNo.slice(0, 8), accountNo.slice(8)];
  return [accountNo, '01'];
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

// ── 국내주식 체결내역 — 공식 스펙: POST, TTTC8001R
async function getDomesticTrades(token, appKey, appSecret, accountNo) {
  const [acctNum, acctSuffix] = parseAccount(accountNo);
  const trades = [];
  const errors = [];
  let ctxFk = '', ctxNk = '';

  for (let page = 0; page < 5; page++) {
    const body = {
      CANO:             acctNum,
      ACNT_PRDT_CD:     acctSuffix || '01',
      INQR_STRT_DT:    START_DATE,
      INQR_END_DT:     todayStr(),
      SLL_BUY_DVSN_CD: '00',   // 00:전체, 01:매도, 02:매수
      INQR_DVSN:       '00',   // 00:역순
      PDNO:            '',
      CCLD_DVSN:       '01',   // 01:체결, 02:미체결
      ORD_GNO_BRNO:    '',
      ODNO:            '',
      INQR_DVSN_3:     '00',
      INQR_DVSN_1:     '',
      CTX_AREA_FK100:   ctxFk,
      CTX_AREA_NK100:   ctxNk,
    };

    const res  = await fetch(`${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-daily-ccld`, {
      method: 'POST',   // ← POST 방식 (공식 스펙)
      headers: {
        'Content-Type':  'application/json',
        'authorization': `Bearer ${token}`,
        'appkey':        appKey,
        'appsecret':     appSecret,
        'tr_id':         'TTTC8001R',
        'custtype':      'P',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (data.rt_cd !== '0') {
      errors.push(`TTTC8001R: ${data.msg1}`);
      break;
    }

    (data.output1 || []).forEach(t => {
      const qty = parseInt(t.tot_ccld_qty || 0);
      if (!t.pdno || qty === 0) return;
      // sll_buy_dvsn_cd: 01=매도, 02=매수
      trades.push({
        market:    'KR',
        symbol:    t.pdno,
        name:      t.prdt_name,
        date:      t.ord_dt,
        side:      t.sll_buy_dvsn_cd === '01' ? 'SELL' : 'BUY',
        qty,
        price:     parseFloat(t.avg_prvs  || 0),
        amount:    parseFloat(t.tot_ccld_amt || 0),
        raw_dvsn:  t.sll_buy_dvsn_cd,
      });
    });

    // 연속 조회
    if (data.tr_cont === 'D' || data.tr_cont === 'E' || !data.tr_cont) break;
    ctxFk = data.ctx_area_fk100 || '';
    ctxNk = data.ctx_area_nk100 || '';
    if (!ctxFk && !ctxNk) break;
  }

  return { trades, errors };
}

// ── 해외주식 체결내역 — 공식 스펙: GET, TTTS3035R, INQR_STRT_DT/INQR_END_DT
async function getOverseasTrades(token, appKey, appSecret, accountNo) {
  const [acctNum, acctSuffix] = parseAccount(accountNo);
  const trades = [];
  const errors = [];
  const today  = todayStr();

  for (const excd of ['NASD', 'NYSE', 'AMEX']) {
    let ctxFk = '', ctxNk = '';

    for (let page = 0; page < 5; page++) {
      const params = new URLSearchParams({
        CANO:             acctNum,
        ACNT_PRDT_CD:     acctSuffix || '01',
        PDNO:             '',
        INQR_STRT_DT:    START_DATE,   // 공식 필드명: INQR_STRT_DT
        INQR_END_DT:     today,        // 공식 필드명: INQR_END_DT
        SLL_BUY_DVSN_CD: '00',
        CCLD_NCCS_DVSN:  '01',        // 01:체결
        OVRS_EXCG_CD:    excd,
        SORT_SQN:        'DS',
        CTX_AREA_FK200:   ctxFk,
        CTX_AREA_NK200:   ctxNk,
      });

      const res  = await fetch(`${KIS_BASE}/uapi/overseas-stock/v1/trading/inquire-ccnl?${params}`, {
        method: 'GET',
        headers: {
          'Content-Type':  'application/json',
          'authorization': `Bearer ${token}`,
          'appkey':        appKey,
          'appsecret':     appSecret,
          'tr_id':         'TTTS3035R',
          'custtype':      'P',
        },
      });

      const data = await res.json();
      if (data.rt_cd !== '0') {
        errors.push(`${excd}/TTTS3035R: ${data.msg1}`);
        break;
      }

      const output = data.output1 || data.output || [];
      output.forEach(t => {
        // 공식 응답 필드: ft_ccld_qty(체결수량), ft_ccld_unpr3(체결단가), sll_buy_dvsn_cd(매도매수구분)
        const qty = parseFloat(t.ft_ccld_qty || 0);
        if (!t.pdno || qty === 0) return;
        trades.push({
          market:   'US',
          exchange: excd,
          symbol:   t.pdno,
          name:     t.prdt_name || '',
          date:     t.ord_dt   || '',
          side:     t.sll_buy_dvsn_cd === '01' ? 'SELL' : 'BUY',
          qty,
          price:    parseFloat(t.ft_ccld_unpr3 || 0),   // 공식 필드명
          amount:   parseFloat(t.ft_ccld_amt3  || 0),   // 공식 필드명
          raw_dvsn: t.sll_buy_dvsn_cd,
        });
      });

      if (data.tr_cont === 'D' || data.tr_cont === 'E' || !data.tr_cont) break;
      ctxFk = data.ctx_area_fk200 || '';
      ctxNk = data.ctx_area_nk200 || '';
      if (!ctxFk && !ctxNk) break;
    }
  }

  return { trades, errors };
}

function calcRealizedPnL(trades, symbol, avgBuyPrice) {
  const sells = trades.filter(t => t.symbol === symbol && t.side === 'SELL');
  let realizedPnL = 0, soldQty = 0;
  sells.forEach(t => { realizedPnL += (t.price - avgBuyPrice) * t.qty; soldQty += t.qty; });
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

    const [oResult, dResult] = await Promise.allSettled([
      token1 ? getOverseasTrades(token1, acc1.key, acc1.secret, acc1.account) : Promise.resolve({ trades:[], errors:[] }),
      token2 && acc2.account ? getDomesticTrades(token2, acc2.key, acc2.secret, acc2.account) : Promise.resolve({ trades:[], errors:[] }),
    ]);

    const oTrades = oResult.status === 'fulfilled' ? oResult.value.trades : [];
    const dTrades = dResult.status === 'fulfilled' ? dResult.value.trades : [];
    const oErrors = oResult.status === 'fulfilled' ? oResult.value.errors : [oResult.reason?.message];
    const dErrors = dResult.status === 'fulfilled' ? dResult.value.errors : [dResult.reason?.message];

    return res.status(200).json({
      trades:   [...dTrades, ...oTrades],
      realized: {
        samsung: calcRealizedPnL(dTrades, '005930', 349500),
        micron:  calcRealizedPnL(oTrades, 'MU',     1040.5953),
      },
      debug: {
        muTrades:      oTrades.filter(t => t.symbol === 'MU'),
        samsungTrades: dTrades.filter(t => t.symbol === '005930'),
        oErrors,
        dErrors,
      },
      timestamp: Date.now(),
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
