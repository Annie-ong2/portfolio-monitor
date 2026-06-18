// Vercel 서버리스 함수 — 한국투자증권 계좌 연동
// 토큰 캐싱: Vercel 환경변수 기반 인메모리 캐시 (인스턴스당 유지)

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';

// ── 인메모리 토큰 캐시 (Vercel 워커 인스턴스 내 유지)
let _cachedToken = null;
let _tokenExpiry  = 0;

async function getToken(appKey, appSecret) {
  const now = Date.now();

  // 유효한 캐시 토큰이 있으면 재사용 (만료 5분 전까지)
  if (_cachedToken && now < _tokenExpiry - 5 * 60 * 1000) {
    return _cachedToken;
  }

  const res = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey:     appKey,
      appsecret:  appSecret,
    }),
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('토큰 발급 실패: ' + JSON.stringify(data));
  }

  // 토큰 캐시 저장 (KIS 토큰 유효기간 24시간)
  _cachedToken = data.access_token;
  _tokenExpiry  = now + (data.expires_in ? data.expires_in * 1000 : 86400 * 1000);

  return _cachedToken;
}

// ── 계좌번호 파싱 (예: "50123456789" → ["50123456", "89"] 또는 "12345678-01" → ["12345678", "01"])
function parseAccount(accountNo) {
  if (accountNo.includes('-')) return accountNo.split('-');
  if (accountNo.length >= 10) return [accountNo.slice(0, 8), accountNo.slice(8)];
  return [accountNo, '01'];
}

// ── 국내주식 잔고 조회
async function getDomesticBalance(token, appKey, appSecret, accountNo) {
  const [acctNum, acctSuffix] = parseAccount(accountNo);

  const params = new URLSearchParams({
    CANO:                   acctNum,
    ACNT_PRDT_CD:           acctSuffix || '01',
    AFHR_FLPR_YN:           'N',
    OFL_YN:                 '',
    INQR_DVSN:              '02',
    UNPR_DVSN:              '01',
    FUND_STTL_ICLD_YN:      'N',
    FNCG_AMT_AUTO_RDPT_YN:  'N',
    PRCS_DVSN:              '01',
    CTX_AREA_FK100:         '',
    CTX_AREA_NK100:         '',
  });

  const res = await fetch(
    `${KIS_BASE}/uapi/domestic-stock/v1/trading/inquire-balance?${params}`,
    {
      headers: {
        'Content-Type':  'application/json',
        'authorization': `Bearer ${token}`,
        'appkey':        appKey,
        'appsecret':     appSecret,
        'tr_id':         'TTTC8434R',
        'custtype':      'P',
      },
    }
  );

  const data = await res.json();
  if (data.rt_cd !== '0') throw new Error('국내잔고 조회 실패: ' + data.msg1);

  return (data.output1 || []).map(item => ({
    market:    'KR',
    symbol:    item.pdno,
    name:      item.prdt_name,
    qty:       parseInt(item.hldg_qty)          || 0,
    avgPrice:  parseFloat(item.pchs_avg_pric)   || 0,
    currPrice: parseFloat(item.prpr)            || 0,
    pnlAmt:    parseFloat(item.evlu_pfls_amt)   || 0,
    pnlRate:   parseFloat(item.evlu_pfls_rt)    || 0,
    evalAmt:   parseFloat(item.evlu_amt)        || 0,
  })).filter(h => h.qty > 0);
}

// ── 해외주식 잔고 조회 (나스닥 → 뉴욕 순으로 조회)
async function getOverseasBalance(token, appKey, appSecret, accountNo) {
  const [acctNum, acctSuffix] = parseAccount(accountNo);
  const exchanges = ['NASD', 'NYSE', 'AMEX'];
  const all = [];

  for (const excd of exchanges) {
    const params = new URLSearchParams({
      CANO:            acctNum,
      ACNT_PRDT_CD:    acctSuffix || '01',
      OVRS_EXCG_CD:    excd,
      TR_CRCY_CD:      'USD',
      CTX_AREA_FK200:  '',
      CTX_AREA_NK200:  '',
    });

    try {
      const res = await fetch(
        `${KIS_BASE}/uapi/overseas-stock/v1/trading/inquire-balance?${params}`,
        {
          headers: {
            'Content-Type':  'application/json',
            'authorization': `Bearer ${token}`,
            'appkey':        appKey,
            'appsecret':     appSecret,
            'tr_id':         'TTTS3012R',
            'custtype':      'P',
          },
        }
      );
      const data = await res.json();
      if (data.rt_cd !== '0') continue;

      const items = (data.output1 || [])
        .map(item => ({
          market:    'US',
          exchange:  excd,
          symbol:    item.ovrs_pdno,
          name:      item.ovrs_item_name,
          qty:       parseInt(item.ovrs_cblc_qty)         || 0,
          avgPrice:  parseFloat(item.pchs_avg_pric)       || 0,
          currPrice: parseFloat(item.now_pric2)           || 0,
          pnlAmt:    parseFloat(item.frcr_evlu_pfls_amt)  || 0,
          pnlRate:   parseFloat(item.evlu_pfls_rt)        || 0,
          evalAmt:   parseFloat(item.ovrs_stck_evlu_amt)  || 0,
        }))
        .filter(h => h.qty > 0);

      all.push(...items);
    } catch(e) {
      continue;
    }
  }

  return all;
}

// ── 메인 핸들러
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const appKey    = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;
  const accountNo = process.env.KIS_ACCOUNT_NO;

  if (!appKey || !appSecret || !accountNo) {
    return res.status(500).json({ error: 'KIS 환경변수 미설정' });
  }

  try {
    const token = await getToken(appKey, appSecret);

    const [domestic, overseas] = await Promise.allSettled([
      getDomesticBalance(token, appKey, appSecret, accountNo),
      getOverseasBalance(token, appKey, appSecret, accountNo),
    ]);

    return res.status(200).json({
      domestic:      domestic.status === 'fulfilled' ? domestic.value : [],
      overseas:      overseas.status === 'fulfilled' ? overseas.value : [],
      domesticError: domestic.status  === 'rejected'  ? domestic.reason?.message : null,
      overseasError: overseas.status  === 'rejected'  ? overseas.reason?.message : null,
      tokenCached:   !!_cachedToken,
      timestamp:     Date.now(),
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
