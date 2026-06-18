// Vercel 서버리스 함수 — 체결내역 + 실현손익 조회
// 계좌1: 마이크론 해외 (KIS_APP_KEY)
// 계좌2: 삼성전자 국내 (KIS_APP_KEY2)

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
const START_DATE = '20260602'; // 최초 매수일

// ── 토큰 캐시 (account.js와 별도 인스턴스)
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
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}${mm}${dd}`;
}

// ── 국내주식 일별 체결내역 조회
async function getDomesticTrades(token, appKey, appSecret, accountNo) {
  const [acctNum, acctSuffix] = parseAccount(accountNo);
  const today = todayStr();
  const trades = [];
  let ctxFk = '', ctxNk = '';

  // 페이지 순회 (최대 5페이지)
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({
      CANO:            acctNum,
      ACNT_PRDT_CD:    acctSuffix || '01',
      INQR_STRT_DT:   START_DATE,
      INQR_END_DT:    today,
      SLL_BUY_DVSN_CD: '00',  // 전체 (매수+매도)
      INQR_DVSN:      '00',
      PDNO:           '',
      CCLD_DVSN:      '01',   // 체결
      ORD_GNO_BRNO:   '',
      ODNO:           '',
      INQR_DVSN_3:    '00',
      INQR_DVSN_1:    '',
      CTX_AREA_FK100:  ctxFk,
      CTX_AREA_NK100:  ctxNk,
    });

    const res  = await fetch(
      `${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-daily-ccld?${params}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'authorization': `Bearer ${token}`,
          'appkey': appKey, 'appsecret': appSecret,
          'tr_id': 'TTTC8001R', 'custtype': 'P',
        },
      }
    );
    const data = await res.json();
    if (data.rt_cd !== '0') break;

    (data.output1 || []).forEach(t => {
      if (!t.pdno || parseInt(t.tot_ccld_qty) === 0) return;
      trades.push({
        market:   'KR',
        symbol:   t.pdno,
        name:     t.prdt_name,
        date:     t.ord_dt,               // 주문일자 YYYYMMDD
        side:     t.sll_buy_dvsn_cd === '01' ? 'SELL' : 'BUY',
        qty:      parseInt(t.tot_ccld_qty),
        price:    parseFloat(t.avg_prvs),  // 평균체결가
        amount:   parseFloat(t.tot_ccld_amt),
      });
    });

    // 다음 페이지
    if (data.tr_cont === 'D' || data.tr_cont === 'E') break;
    ctxFk = data.ctx_area_fk100 || '';
    ctxNk = data.ctx_area_nk100 || '';
    if (!ctxFk && !ctxNk) break;
  }
  return trades;
}

// ── 해외주식 체결내역 조회
async function getOverseasTrades(token, appKey, appSecret, accountNo) {
  const [acctNum, acctSuffix] = parseAccount(accountNo);
  const today = todayStr();
  const trades = [];
  const exchanges = ['NASD', 'NYSE', 'AMEX'];

  for (const excd of exchanges) {
    let ctxFk = '', ctxNk = '';

    for (let page = 0; page < 5; page++) {
      const params = new URLSearchParams({
        CANO:            acctNum,
        ACNT_PRDT_CD:    acctSuffix || '01',
        PDNO:            '',
        ORD_STRT_DT:    START_DATE,
        ORD_END_DT:     today,
        SLL_BUY_DVSN_CD: '00',
        CCLD_NCCS_DVSN: '01',   // 체결
        OVRS_EXCG_CD:   excd,
        SORT_SQN:       'DS',
        CTX_AREA_FK200:  ctxFk,
        CTX_AREA_NK200:  ctxNk,
      });

      try {
        const res  = await fetch(
          `${KIS_BASE}/uapi/overseas-stock/v1/trading/inquire-ccnl?${params}`,
          {
            headers: {
              'Content-Type': 'application/json',
              'authorization': `Bearer ${token}`,
              'appkey': appKey, 'appsecret': appSecret,
              'tr_id': 'TTTS3035R', 'custtype': 'P',
            },
          }
        );
        const data = await res.json();
        if (data.rt_cd !== '0') break;

        (data.output || []).forEach(t => {
          if (!t.pdno || parseFloat(t.ft_ccld_qty) === 0) return;
          trades.push({
            market:   'US',
            exchange: excd,
            symbol:   t.pdno,
            name:     t.prdt_name,
            date:     t.ord_dt,
            side:     t.sll_buy_dvsn_cd === '01' ? 'SELL' : 'BUY',
            qty:      parseFloat(t.ft_ccld_qty),
            price:    parseFloat(t.ft_ccld_unpr3),  // 체결단가 (USD)
            amount:   parseFloat(t.ft_ccld_amt3),   // 체결금액 (USD)
          });
        });

        if (data.tr_cont === 'D' || data.tr_cont === 'E') break;
        ctxFk = data.ctx_area_fk200 || '';
        ctxNk = data.ctx_area_nk200 || '';
        if (!ctxFk && !ctxNk) break;
      } catch(e) { break; }
    }
  }
  return trades;
}

// ── 실현손익 계산 (FIFO 방식)
function calcRealizedPnL(trades, symbol, avgBuyPrice) {
  const sells = trades.filter(t => t.symbol === symbol && t.side === 'SELL');
  let totalRealizedPnL = 0;
  let totalSoldQty = 0;

  sells.forEach(t => {
    const pnl = (t.price - avgBuyPrice) * t.qty;
    totalRealizedPnL += pnl;
    totalSoldQty     += t.qty;
  });

  return { realizedPnL: totalRealizedPnL, soldQty: totalSoldQty };
}

// ── 메인 핸들러
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

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

    // 체결내역 조회
    const [overseasTrades, domesticTrades] = await Promise.allSettled([
      token1 ? getOverseasTrades(token1, acc1.key, acc1.secret, acc1.account) : Promise.resolve([]),
      token2 && acc2.account ? getDomesticTrades(token2, acc2.key, acc2.secret, acc2.account) : Promise.resolve([]),
    ]);

    const oTrades = overseasTrades.status  === 'fulfilled' ? overseasTrades.value  : [];
    const dTrades = domesticTrades.status  === 'fulfilled' ? domesticTrades.value  : [];
    const allTrades = [...dTrades, ...oTrades];

    // 실현손익 계산
    const samsungPnL = calcRealizedPnL(dTrades, '005930', 349500);
    const micronPnL  = calcRealizedPnL(oTrades, 'MU',     1040.5953);

    return res.status(200).json({
      trades:   allTrades,
      realized: {
        samsung: samsungPnL,
        micron:  micronPnL,
      },
      timestamp: Date.now(),
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
