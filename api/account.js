// Vercel 서버리스 함수 — 한국투자증권 계좌 연동
// 1. 토큰 발급 → 2. 국내주식 잔고 → 3. 해외주식 잔고 조회

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';

// ── 토큰 발급 (매 호출마다 발급 — Vercel 무상태 환경)
async function getToken(appKey, appSecret) {
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
  if (!data.access_token) throw new Error('토큰 발급 실패: ' + JSON.stringify(data));
  return data.access_token;
}

// ── 국내주식 잔고 조회
async function getDomesticBalance(token, appKey, appSecret, accountNo) {
  const [acctNum, acctSuffix] = accountNo.includes('-')
    ? accountNo.split('-')
    : [accountNo.slice(0, 8), accountNo.slice(8)];

  const params = new URLSearchParams({
    CANO:            acctNum,
    ACNT_PRDT_CD:    acctSuffix || '01',
    AFHR_FLPR_YN:    'N',
    OFL_YN:          '',
    INQR_DVSN:       '02',
    UNPR_DVSN:       '01',
    FUND_STTL_ICLD_YN: 'N',
    FNCG_AMT_AUTO_RDPT_YN: 'N',
    PRCS_DVSN:       '01',
    CTX_AREA_FK100:  '',
    CTX_AREA_NK100:  '',
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

  // 보유 종목 파싱
  return (data.output1 || []).map(item => ({
    market:    'KR',
    symbol:    item.pdno,           // 종목코드
    name:      item.prdt_name,      // 종목명
    qty:       parseInt(item.hldg_qty),              // 보유수량
    avgPrice:  parseFloat(item.pchs_avg_pric),       // 매입평균가
    currPrice: parseFloat(item.prpr),                // 현재가
    pnlAmt:    parseFloat(item.evlu_pfls_amt),       // 평가손익
    pnlRate:   parseFloat(item.evlu_pfls_rt),        // 수익률
    evalAmt:   parseFloat(item.evlu_amt),            // 평가금액
  })).filter(h => h.qty > 0);
}

// ── 해외주식 잔고 조회
async function getOverseasBalance(token, appKey, appSecret, accountNo) {
  const [acctNum, acctSuffix] = accountNo.includes('-')
    ? accountNo.split('-')
    : [accountNo.slice(0, 8), accountNo.slice(8)];

  const params = new URLSearchParams({
    CANO:            acctNum,
    ACNT_PRDT_CD:    acctSuffix || '01',
    OVRS_EXCG_CD:    'NASD',   // NASD=나스닥, NYSE=뉴욕, AMEX=아멕스
    TR_CRCY_CD:      'USD',
    CTX_AREA_FK200:  '',
    CTX_AREA_NK200:  '',
  });

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
  if (data.rt_cd !== '0') throw new Error('해외잔고 조회 실패: ' + data.msg1);

  return (data.output1 || []).map(item => ({
    market:    'US',
    symbol:    item.ovrs_pdno,       // 종목코드 (예: MU)
    name:      item.ovrs_item_name,  // 종목명
    qty:       parseInt(item.ovrs_cblc_qty),          // 보유수량
    avgPrice:  parseFloat(item.pchs_avg_pric),        // 매입평균가 (USD)
    currPrice: parseFloat(item.now_pric2),            // 현재가 (USD)
    pnlAmt:    parseFloat(item.frcr_evlu_pfls_amt),   // 평가손익 (USD)
    pnlRate:   parseFloat(item.evlu_pfls_rt),         // 수익률
    evalAmt:   parseFloat(item.ovrs_stck_evlu_amt),   // 평가금액 (USD)
  })).filter(h => h.qty > 0);
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
    // 토큰 발급
    const token = await getToken(appKey, appSecret);

    // 국내 + 해외 잔고 병렬 조회
    const [domestic, overseas] = await Promise.allSettled([
      getDomesticBalance(token, appKey, appSecret, accountNo),
      getOverseasBalance(token, appKey, appSecret, accountNo),
    ]);

    return res.status(200).json({
      domestic: domestic.status === 'fulfilled' ? domestic.value : [],
      overseas: overseas.status === 'fulfilled' ? overseas.value : [],
      domesticError: domestic.status === 'rejected' ? domestic.reason?.message : null,
      overseasError: overseas.status === 'rejected' ? overseas.reason?.message : null,
      timestamp: Date.now(),
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
