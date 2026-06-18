// Vercel 서버리스 함수 — 한국투자증권 두 계좌 연동
// 계좌1: 마이크론  (KIS_APP_KEY  / KIS_APP_SECRET  / KIS_ACCOUNT_NO)
// 계좌2: 삼성전자 (KIS_APP_KEY2 / KIS_APP_SECRET2 / KIS_ACCOUNT_NO2)

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';

// ── 계좌별 토큰 캐시
const _cache = {
  1: { token: null, expiry: 0 },
  2: { token: null, expiry: 0 },
};

async function getToken(appKey, appSecret, cacheKey) {
  const now   = Date.now();
  const cache = _cache[cacheKey];

  if (cache.token && now < cache.expiry - 5 * 60 * 1000) {
    return cache.token;
  }

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
  const clean = accountNo.trim().replace(/-/g, '');
  if (clean.length === 8)  return [clean, '01'];
  if (clean.length >= 10)  return [clean.slice(0,8), clean.slice(8)];
  return [clean, '01'];
}

// ── 국내주식 잔고 조회
async function getDomesticBalance(token, appKey, appSecret, accountNo) {
  const [acctNum, acctSuffix] = parseAccount(accountNo);
  const params = new URLSearchParams({
    CANO: acctNum, ACNT_PRDT_CD: acctSuffix || '01',
    AFHR_FLPR_YN: 'N', OFL_YN: '', INQR_DVSN: '02', UNPR_DVSN: '01',
    FUND_STTL_ICLD_YN: 'N', FNCG_AMT_AUTO_RDPT_YN: 'N', PRCS_DVSN: '01',
    CTX_AREA_FK100: '', CTX_AREA_NK100: '',
  });

  for (const trId of ['TTTC8434R', 'TTTC8908R']) {
    const res  = await fetch(`${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-balance?${params}`, {
      headers: {
        'Content-Type': 'application/json', 'authorization': `Bearer ${token}`,
        'appkey': appKey, 'appsecret': appSecret, 'tr_id': trId, 'custtype': 'P',
      },
    });
    const data = await res.json();
    if (data.rt_cd !== '0') continue;

    return (data.output1 || []).map(item => ({
      market:    'KR',
      symbol:    item.pdno,
      name:      item.prdt_name,
      qty:       parseInt(item.hldg_qty)         || 0,
      avgPrice:  parseFloat(item.pchs_avg_pric)  || 0,
      currPrice: parseFloat(item.prpr)           || 0,
      pnlAmt:    parseFloat(item.evlu_pfls_amt)  || 0,
      pnlRate:   parseFloat(item.evlu_pfls_rt)   || 0,
      evalAmt:   parseFloat(item.evlu_amt)       || 0,
    })).filter(h => h.qty > 0);
  }
  throw new Error('국내잔고 조회 실패');
}

// ── 해외주식 잔고 조회
async function getOverseasBalance(token, appKey, appSecret, accountNo) {
  const [acctNum, acctSuffix] = parseAccount(accountNo);
  const all = [];

  for (const excd of ['NASD', 'NYSE', 'AMEX']) {
    const params = new URLSearchParams({
      CANO: acctNum, ACNT_PRDT_CD: acctSuffix || '01',
      OVRS_EXCG_CD: excd, TR_CRCY_CD: 'USD',
      CTX_AREA_FK200: '', CTX_AREA_NK200: '',
    });
    try {
      const res  = await fetch(`${KIS_BASE}/uapi/overseas-stock/v1/trading/inquire-balance?${params}`, {
        headers: {
          'Content-Type': 'application/json', 'authorization': `Bearer ${token}`,
          'appkey': appKey, 'appsecret': appSecret, 'tr_id': 'TTTS3012R', 'custtype': 'P',
        },
      });
      const data = await res.json();
      if (data.rt_cd !== '0') continue;

      all.push(...(data.output1 || []).map(item => ({
        market:    'US',
        exchange:  excd,
        symbol:    item.ovrs_pdno,
        name:      item.ovrs_item_name,
        qty:       parseInt(item.ovrs_cblc_qty)        || 0,
        avgPrice:  parseFloat(item.pchs_avg_pric)      || 0,
        currPrice: parseFloat(item.now_pric2)          || 0,
        pnlAmt:    parseFloat(item.frcr_evlu_pfls_amt) || 0,
        pnlRate:   parseFloat(item.evlu_pfls_rt)       || 0,
        evalAmt:   parseFloat(item.ovrs_stck_evlu_amt) || 0,
      })).filter(h => h.qty > 0));
    } catch(e) { continue; }
  }
  return all;
}

// ── 메인 핸들러
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const acc1 = {
    key:     process.env.KIS_APP_KEY,
    secret:  process.env.KIS_APP_SECRET,
    account: process.env.KIS_ACCOUNT_NO,
  };
  const acc2 = {
    key:     process.env.KIS_APP_KEY2,
    secret:  process.env.KIS_APP_SECRET2,
    account: process.env.KIS_ACCOUNT_NO2,
  };

  if (!acc1.key || !acc1.secret || !acc1.account) {
    return res.status(500).json({ error: 'KIS 환경변수 미설정 (계좌1)' });
  }

  try {
    // 두 계좌 토큰 동시 발급
    const [t1Result, t2Result] = await Promise.allSettled([
      getToken(acc1.key, acc1.secret, 1),
      acc2.key && acc2.secret ? getToken(acc2.key, acc2.secret, 2) : Promise.resolve(null),
    ]);

    const token1 = t1Result.status === 'fulfilled' ? t1Result.value : null;
    const token2 = t2Result.status === 'fulfilled' ? t2Result.value : null;

    // 병렬 조회: 계좌1=해외(마이크론) / 계좌2=국내(삼성전자)
    const [overseasResult, domesticResult] = await Promise.allSettled([
      token1 ? getOverseasBalance(token1, acc1.key, acc1.secret, acc1.account) : Promise.resolve([]),
      token2 && acc2.account
        ? getDomesticBalance(token2, acc2.key, acc2.secret, acc2.account)
        : Promise.resolve([]),
    ]);

    // 23시간 캐시 — 토큰 1일 1회 발급 원칙 준수
    res.setHeader('Cache-Control', 's-maxage=82800, stale-while-revalidate');
    return res.status(200).json({
      domestic:          domesticResult.status === 'fulfilled' ? domesticResult.value : [],
      overseas:          overseasResult.status === 'fulfilled' ? overseasResult.value : [],
      domesticError:     domesticResult.status === 'rejected'  ? domesticResult.reason?.message : null,
      overseasError:     overseasResult.status === 'rejected'  ? overseasResult.reason?.message : null,
      account1Connected: !!token1,
      account2Connected: !!token2,
      timestamp:         Date.now(),
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
