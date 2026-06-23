// Vercel 서버리스 함수 — Claude API 뉴스 분석
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API 키 미설정' });

  const { headlines, portfolio } = req.body;
  if (!headlines || headlines.length === 0) {
    return res.status(400).json({ error: '헤드라인 없음' });
  }

  const headlineText = headlines.map((h, i) =>
    `[${i+1}] (${h.source}) ${h.title} | ${h.desc}`
  ).join('\n');

  // 실시간 포트폴리오 정보 반영
  const samInfo = portfolio?.samsung
    ? `${portfolio.samsung.qty || 70}주, 매입단가 ${portfolio.samsung.bep || 349500}원, 현재가 ${portfolio.samsung.currentPrice}, 수익률 ${portfolio.samsung.returnPct}%`
    : '70주, 매입단가 349,500원';
  const muInfo = portfolio?.micron
    ? `${portfolio.micron.qty || 15}주, 매입단가 $${portfolio.micron.bep || 1040.60}, 현재가 ${portfolio.micron.currentPrice}, 수익률 ${portfolio.micron.returnPct}%`
    : '15주, 매입단가 $1,040.60';

  const prompt = `당신은 삼성전자(005930.KS)와 마이크론 테크놀로지(MU) 두 종목을 보유한 투자자의 포트폴리오 모니터링 AI입니다.

현재 보유 현황 (실시간):
- 삼성전자: ${samInfo}
- 마이크론: ${muInfo}
- 전략: 3개월 중기 보유, 매수 논리 훼손 시 매도
- 익절 목표: 삼성전자 1차 380,000원/2차 420,000원, 마이크론 1차 $1,100/2차 $1,200

아래 최신 뉴스를 분석해 두 종목 투자 전략에 중요한 영향을 줄 이슈를 골라주세요.

감지 기준:
1. 지정학/외교: 트럼프 발언, 미중 갈등, 중동 전쟁
2. AI 산업: 빅테크 AI 투자 변화, 중국 AI 돌파구
3. 자금 이동: SpaceX IPO, 비트코인 급등 등 수급 이탈
4. 반도체: HBM 수요 변화, 공급 과잉, 경쟁사 동향
5. 금리/환율: 연준 발언, 원달러 급변

뉴스 목록:
${headlineText}

JSON만 응답 (다른 텍스트 없이):
{
  "alerts": [
    {
      "impact": "HIGH 또는 MEDIUM 또는 LOW",
      "category": "지정학 또는 AI산업 또는 자금이동 또는 반도체 또는 금리환율",
      "title": "핵심 이슈 제목 (30자 이내)",
      "analysis": "두 종목 영향 분석 (60자 이내)",
      "affected": ["삼성전자", "마이크론"] 중 해당 종목,
      "action": "HOLD 또는 WATCH 또는 REVIEW",
      "sourceIndex": 뉴스번호
    }
  ],
  "summary": "전체 시장 상황 한 줄 요약 (50자 이내)"
}

중요한 이슈만 최대 6개 선별하세요.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const raw = data.content?.map(c => c.text || '').join('') || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return res.status(200).json(parsed);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
