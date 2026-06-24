// 체결내역 저장/조회 — 노션 DB 연동
// 노션 DB ID: 41c58398-43ad-46b2-8e73-e7d0bca6a833

const NOTION_DB = '41c58398-43ad-46b2-8e73-e7d0bca6a833';
const NOTION_API = 'https://api.notion.com/v1';

function notionHeaders() {
  return {
    'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28',
  };
}

// GET: 체결내역 전체 조회
async function getTrades() {
  const res = await fetch(`${NOTION_API}/databases/${NOTION_DB}/query`, {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({ sorts: [{ property: 'date', direction: 'ascending' }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || '노션 조회 실패');

  return (data.results || []).map(p => {
    const props = p.properties;
    return {
      id:     p.id,
      market: props.market?.rich_text?.[0]?.plain_text || '',
      symbol: props.symbol?.rich_text?.[0]?.plain_text || '',
      name:   props.Name?.title?.[0]?.plain_text || '',
      date:   props.date?.rich_text?.[0]?.plain_text || '',
      side:   props.side?.select?.name || '',
      qty:    props.qty?.number || 0,
      price:  props.price?.number || 0,
      source: props.source?.rich_text?.[0]?.plain_text || 'manual',
    };
  });
}

// POST: 체결내역 추가
async function addTrade(trade) {
  const label = `${trade.symbol} ${trade.side === 'SELL' ? '매도' : '매수'} ${trade.qty}주 (${trade.date.slice(4,6)}.${trade.date.slice(6,8)})`;
  const res = await fetch(`${NOTION_API}/pages`, {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({
      parent: { database_id: NOTION_DB },
      properties: {
        Name:   { title: [{ text: { content: label } }] },
        market: { rich_text: [{ text: { content: trade.market } }] },
        symbol: { rich_text: [{ text: { content: trade.symbol } }] },
        date:   { rich_text: [{ text: { content: trade.date } }] },
        side:   { select: { name: trade.side } },
        qty:    { number: trade.qty },
        price:  { number: trade.price },
        source: { rich_text: [{ text: { content: 'manual' } }] },
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || '노션 저장 실패');
  return { id: data.id };
}

// DELETE: 체결내역 삭제 (페이지 보관)
async function deleteTrade(pageId) {
  const res = await fetch(`${NOTION_API}/pages/${pageId}`, {
    method: 'PATCH',
    headers: notionHeaders(),
    body: JSON.stringify({ archived: true }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.message || '노션 삭제 실패');
  }
  return { ok: true };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.NOTION_TOKEN) {
    return res.status(500).json({ error: 'NOTION_TOKEN 환경변수 미설정' });
  }

  try {
    if (req.method === 'GET') {
      const trades = await getTrades();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ trades });
    }

    if (req.method === 'POST') {
      const { market, symbol, name, date, side, qty, price } = req.body;
      if (!symbol || !date || !side || !qty || !price) {
        return res.status(400).json({ error: '필수 항목 누락' });
      }
      const result = await addTrade({ market, symbol, name, date, side, qty: Number(qty), price: Number(price) });
      return res.status(200).json({ ok: true, id: result.id });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'id 누락' });
      await deleteTrade(id);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}


