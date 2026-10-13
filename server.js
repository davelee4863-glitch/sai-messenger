// 사이 메신저 — 부드러운 그룹 채팅 + AI 옵저버
// AI는 조용히 지켜보다가 합의가 감지되면 자동으로 메모/캘린더에 저장
const express = require('express');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 3101;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

app.use(express.static(path.join(__dirname, 'public')));

// 방별 데이터: { messages: [], members: Set<ws>, agreement: null }
const rooms = new Map();

function getRoom(code) {
  if (!rooms.has(code)) rooms.set(code, { messages: [], members: new Set(), agreement: null });
  return rooms.get(code);
}

function getLLM() {
  if (DEEPSEEK_API_KEY) return { key: DEEPSEEK_API_KEY, url: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' };
  if (OPENAI_API_KEY) return { key: OPENAI_API_KEY, url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' };
  return null;
}

// AI에게 합의 감지 요청
async function detectAgreement(messages) {
  const llm = getLLM();
  if (!llm || messages.length < 3) return null;

  const convo = messages.slice(-10).map(m => `${m.name}: ${m.text}`).join('\n');

  try {
    const res = await fetch(llm.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${llm.key}` },
      body: JSON.stringify({
        model: llm.model,
        messages: [{
          role: 'system',
          content: `당신은 메신저 대화에서 약속 합의를 감지하는 AI입니다.
대화를 보고 모든 참가자가 날짜, 시간, 장소에 합의했는지 판단하세요.
합의가 명확하면 JSON으로 응답: {"agreed": true, "date": "날짜", "time": "시간", "place": "장소", "summary": "한줄요약"}
합의가 안 됐으면: {"agreed": false}
날짜는 YYYY-MM-DD 형식으로 변환하세요. 오늘은 2026-10-13입니다.`
        }, {
          role: 'user', content: convo
        }],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 300,
      }),
    });
    const data = await res.json();
    const result = JSON.parse(data.choices[0].message.content);
    return result.agreed ? result : null;
  } catch (e) {
    console.error('합의 감지 오류:', e.message);
    return null;
  }
}

function broadcast(room, data, exclude = null) {
  const msg = JSON.stringify(data);
  for (const ws of room.members) {
    if (ws !== exclude && ws.readyState === 1) {
      try { ws.send(msg); } catch {}
    }
  }
}

// 메모/ICS 다운로드
app.get('/api/memo/:room/ics', (req, res) => {
  const room = getRoom(req.params.room);
  if (!room.agreement) return res.status(404).send('합의된 약속이 없어요');
  const a = room.agreement;
  const [y, m, d] = (a.date || '2026-10-18').split('-');
  const [hh, mm] = (a.time || '18:00').split(':');
  const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//SAI Messenger//KO
BEGIN:VEVENT
UID:${Date.now()}@sai.msg
DTSTART:${y}${m}${d}T${hh}${mm}00
DTEND:${y}${m}${d}T${String(parseInt(hh)+2).padStart(2,'0')}${mm}00
SUMMARY:${a.summary || '약속'}
LOCATION:${a.place || ''}
END:VEVENT
END:VCALENDAR`;
  res.header('Content-Type', 'text/calendar');
  res.header('Content-Disposition', 'attachment; filename="약속.ics"');
  res.send(ics);
});

app.get('/api/memo/:room/md', (req, res) => {
  const room = getRoom(req.params.room);
  if (!room.agreement) return res.status(404).send('합의된 약속이 없어요');
  const a = room.agreement;
  const md = `# 약속 메모\n\n- 날짜: ${a.date}\n- 시간: ${a.time}\n- 장소: ${a.place}\n- 내용: ${a.summary}\n\n생성: ${new Date().toLocaleString('ko-KR')}\n`;
  res.header('Content-Type', 'text/markdown; charset=utf-8');
  res.send(md);
});

app.get('/r/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const roomCode = url.searchParams.get('room') || 'default';
  const name = decodeURIComponent(url.searchParams.get('name') || '친구');

  const room = getRoom(roomCode);
  room.members.add(ws);
  ws._room = roomCode;
  ws._name = name;

  // 기존 대화 전송
  ws.send(JSON.stringify({ type: 'history', messages: room.messages }));
  // 입장 알림 (AI 제외)
  if (name !== 'AI') {
    broadcast(room, { type: 'chat', name: 'AI', text: `${name}님이 입장했어요 👋` }, ws);
  }

  ws.on('message', async (raw) => {
    try {
      const d = JSON.parse(raw);
      if (d.type !== 'chat' || !d.text) return;

      const msg = { name, text: d.text, time: Date.now() };
      room.messages.push(msg);
      broadcast(room, { type: 'chat', name, text: d.text });

      // AI 합의 감지 (이미 합의된 방은 스킵)
      if (!room.agreement && room.messages.length >= 3) {
        const agreement = await detectAgreement(room.messages);
        if (agreement) {
          room.agreement = agreement;
          const aiMsg = `📝 약속이 정해진 것 같아요!\n${agreement.date} ${agreement.time}, ${agreement.place}\n캘린더와 메모에 저장할 수 있어요.`;
          room.messages.push({ name: 'AI', text: aiMsg, time: Date.now() });
          broadcast(room, { type: 'chat', name: 'AI', text: aiMsg });
          broadcast(room, { type: 'saved', data: agreement });
        }
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    const room = getRoom(ws._room);
    room.members.delete(ws);
  });
  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log(`사이 메신저 실행 중: http://localhost:${PORT}`);
});
