// 우리끄투 서버: 정적 파일 제공 + WebSocket 멀티플레이
// 실행: npm install && npm start  →  http://localhost:3000
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const { createStore, levelInfo } = require("./store");
const store = createStore();

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
// 브라우저에 보여 줄 파일만 허용 (server.js 등은 노출하지 않음)
const PUBLIC_FILES = new Set(["/index.html", "/words.txt"]);
const MAX_PLAYERS = 8;

/* ---------- 단어 사전 ---------- */
const dict = new Set();
const byFirst = new Map();
// 단어 목록: words.txt가 있으면 그걸, 없으면 index.html 안에 든 목록을 씀
const wordsFile = path.join(ROOT, "words.txt");
const wordText = fs.existsSync(wordsFile)
  ? fs.readFileSync(wordsFile, "utf8")
  : (fs.readFileSync(path.join(ROOT, "index.html"), "utf8").match(/<script type="text\/plain" id="words">([\s\S]*?)<\/script>/) || ["", ""])[1];
// "#" 줄 위는 표준어 명사(제시어용), 아래는 방언·옛말 등 사람이 낼 수 있는 추가 단어
let isStd = true;
for (const w of wordText.split("\n")) {
  if (!w) continue;
  if (w === "#") { isStd = false; continue; }
  dict.add(w);
  if (!isStd) continue;
  let a = byFirst.get(w[0]);
  if (!a) byFirst.set(w[0], (a = []));
  a.push(w);
}
console.log(`단어 ${dict.size.toLocaleString()}개 불러옴`);

const S0 = 0xac00;
const dec = (c) => { const n = c.charCodeAt(0) - S0; return { i: Math.floor(n / 588), m: Math.floor((n % 588) / 28), f: n % 28 }; };
const comp = (i, m, f) => String.fromCharCode(S0 + i * 588 + m * 28 + f);
// 두음법칙: 끝 글자 c 뒤에 올 수 있는 첫 글자들
function alts(c) {
  const { i, m, f } = dec(c), out = [c];
  if (i === 5) {
    if ([2, 6, 7, 12, 17, 20].includes(m)) out.push(comp(11, m, f));
    else if ([0, 1, 8, 11, 13, 18].includes(m)) out.push(comp(2, m, f));
  } else if (i === 2 && [6, 12, 17, 20].includes(m)) out.push(comp(11, m, f));
  return out;
}
const contMemo = new Map();
function contCount(c) {
  if (contMemo.has(c)) return contMemo.get(c);
  let n = 0;
  for (const a of alts(c)) n += (byFirst.get(a) || []).length;
  contMemo.set(c, n);
  return n;
}
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const firstKeys = [...byFirst.keys()];
function startWord() {
  let w;
  for (let k = 0; k < 500; k++) {
    w = pick(byFirst.get(pick(firstKeys)));
    if (w.length === 3 && contCount(w.at(-1)) > 300) break;
  }
  return w;
}

/* ---------- 정적 파일 ---------- */
const MIME = { ".html": "text/html; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".ico": "image/x-icon", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || "/").split("?")[0]);
  if (p === "/") p = "/index.html";
  if (!PUBLIC_FILES.has(p)) { res.writeHead(404); return res.end("Not found"); }
  const file = path.join(ROOT, p);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Content-Length": st.size, "Cache-Control": p.endsWith(".txt") ? "public, max-age=86400" : "no-cache" });
    fs.createReadStream(file).pipe(res);
  });
});

/* ---------- 방 관리 ---------- */
const rooms = new Map();   // code -> room
const conns = new Map();   // ws -> { id, code }
const byId = new Map();    // player id -> ws

const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const newId = () => "p" + crypto.randomBytes(9).toString("base64url");
function newCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s;
  do { s = ""; for (let k = 0; k < 4; k++) s += A[crypto.randomInt(A.length)]; } while (rooms.has(s));
  return s;
}
function setNick(id, nick) {
  const p = store.ensure(id);
  const n = cleanNick(nick, "");
  if (n && n !== p.nick) { p.nick = n; if (p.games || p.user) store.save(p); }
  return p;
}
const cleanNick = (n, fallback) => (String(n || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 12) || fallback);
const multiLimit = (r) => Math.max(6, 15 - (r.chain.length - 1) * 0.35);

/* ---------- 경험치 · 랭킹 ---------- */
function profileView(p) {
  const li = levelInfo(p.exp);
  return { user: p.user || null, nick: p.nick, exp: p.exp, level: li.level, cur: li.cur, need: li.need, wins: p.wins, games: p.games, best: p.best, rank: store.rankOf(p) };
}
function topList() {
  return store.top(50).map((p, i) => ({ rank: i + 1, id: p.id, nick: p.nick, level: levelInfo(p.exp).level, exp: p.exp, wins: p.wins, games: p.games, best: p.best }));
}
// 경험치를 주고, 레벨이 올랐는지 알려 줘요
function reward(id, gained, { win = false, score = 0 } = {}) {
  const p = store.ensure(id);
  const before = levelInfo(p.exp).level;
  p.exp += Math.max(0, Math.round(gained));
  p.games += 1;
  if (win) p.wins += 1;
  p.best = Math.max(p.best, score);
  store.save(p);
  const view = profileView(p);
  send(byId.get(id), { t: "reward", exp: Math.round(gained), levelUp: view.level > before, profile: view });
  return view;
}
function rewardRoom(r) {
  const n = r.players.length;
  for (const p of r.players) {
    const win = p.id === r.winner;
    reward(p.id, p.score + 10 + (win ? 40 * (n - 1) : 0), { win, score: p.score });
    p.lv = levelInfo(store.ensure(p.id).exp).level;
  }
}
/* ---------- 회원가입 · 로그인 ---------- */
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
function hashPw(pw, salt) { return crypto.scryptSync(pw, salt, 32).toString("hex"); }
function checkPw(p, pw) {
  if (!p.pwHash || !p.salt) return false;
  const a = Buffer.from(hashPw(pw, p.salt), "hex"), b = Buffer.from(p.pwHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function issueToken(p) {
  const token = crypto.randomBytes(24).toString("base64url");
  p.tokens = [sha(token), ...(p.tokens || [])].slice(0, 5); // 기기 5대까지 로그인 유지
  store.save(p);
  return token;
}
const tokenOk = (p, token) => typeof token === "string" && (p.tokens || []).includes(sha(token));
const USER_RE = /^[a-z0-9_]{3,16}$/;

/* ---------- 채팅 ---------- */
const lobbyLog = [];
function chatMsg(id, text) {
  const p = store.ensure(id);
  return { id, nick: p.nick, lv: levelInfo(p.exp).level, guest: !p.user, text, ts: Date.now() };
}
function pushLog(log, m) { log.push(m); if (log.length > 50) log.shift(); }
function roomSystem(r, text) {
  const m = { sys: true, text, ts: Date.now() };
  pushLog(r.chat, m);
  for (const p of r.players) send(byId.get(p.id), { t: "chat", ch: "room", m });
}

const SOLO = { easy: { mult: 0.3, win: 10 }, normal: { mult: 0.5, win: 30 }, hard: { mult: 0.8, win: 60 } };
const lastSolo = new Map();

function publicState(r) {
  return {
    code: r.code, status: r.status, host: r.host, players: r.players, turn: r.turn, last: r.last,
    used: r.used, chain: r.chain, limit: r.limit, deadlineIn: Math.max(0, r.deadline - Date.now()),
    seq: r.seq, winner: r.winner, note: r.note, noteId: r.noteId,
  };
}
function broadcast(r) {
  const s = publicState(r);
  for (const p of r.players) send(byId.get(p.id), { t: "state", s });
}
function roomList() {
  return [...rooms.values()].filter((r) => r.status === "lobby").sort((a, b) => b.createdAt - a.createdAt).slice(0, 30)
    .map((r) => ({ code: r.code, host: (r.players.find((p) => p.id === r.host) || r.players[0]).nick, count: r.players.length }));
}
function broadcastRooms() {
  const list = roomList();
  for (const [ws, c] of conns) if (!c.code) send(ws, { t: "rooms", rooms: list });
}
function nextAlive(r) {
  const n = r.players.length;
  for (let k = 1; k <= n; k++) { const c = (r.turn + k) % n; if (!r.players[c].out) return c; }
  return r.turn;
}
function armTimer(r) {
  clearTimeout(r.timer);
  if (r.status !== "playing") return;
  const seq = r.seq;
  r.timer = setTimeout(() => { if (r.seq === seq && r.status === "playing") { eliminate(r, r.turn, "시간 초과"); broadcast(r); } }, Math.max(0, r.deadline - Date.now()) + 300);
}
function eliminate(r, idx, reason) {
  const p = r.players[idx];
  p.out = true; r.seq++;
  r.note = reason; r.noteId = p.id;
  const alive = r.players.filter((q) => !q.out);
  if (alive.length <= 1) {
    r.status = "over"; r.winner = alive[0] ? alive[0].id : null; r.deadline = 0; clearTimeout(r.timer);
    rewardRoom(r);
    return;
  }
  if (idx === r.turn) {
    const w = startWord();
    r.used.push(w); r.usedSet.add(w); r.chain.push({ w, by: null }); r.last = w;
    r.turn = nextAlive(r); r.limit = multiLimit(r); r.deadline = Date.now() + 1500 + r.limit * 1000;
  }
  armTimer(r);
}
function removePlayer(r, id) {
  const idx = r.players.findIndex((p) => p.id === id);
  if (idx < 0) return;
  if (r.status === "playing") {
    if (!r.players[idx].out) eliminate(r, idx, "나감");
    // 나간 사람은 결과에 남겨 두고, 아무도 연결돼 있지 않으면 방 정리
  } else {
    r.players.splice(idx, 1);
    if (r.host === id && r.players.length) r.host = r.players[0].id;
    if (r.turn >= r.players.length) r.turn = 0;
  }
  if (!r.players.some((p) => byId.has(p.id) && conns.get(byId.get(p.id))?.code === r.code)) {
    clearTimeout(r.timer); rooms.delete(r.code);
  } else broadcast(r);
  broadcastRooms();
}
function leave(ws) {
  const c = conns.get(ws);
  if (!c || !c.code) return;
  const r = rooms.get(c.code);
  c.code = null;
  if (r) { removePlayer(r, c.id); if (rooms.has(r.code)) roomSystem(r, `${store.ensure(c.id).nick} 님이 나갔어요.`); }
  send(ws, { t: "left" });
  send(ws, { t: "chatlog", ch: "lobby", list: lobbyLog });
  send(ws, { t: "rooms", rooms: roomList() });
}

/* ---------- 메시지 처리 ---------- */
const wss = new WebSocketServer({ server, maxPayload: 4096 });
const graceTimers = new Map();

wss.on("connection", (ws) => {
  conns.set(ws, { id: null, code: null });
  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== "string") return;
    const c = conns.get(ws);

    if (m.t === "hello") {
      let id = typeof m.id === "string" && /^p[\w-]{8,20}$/.test(m.id) ? m.id : null;
      // 가입한 계정은 로그인 토큰이 맞아야 그 계정으로 들어와요
      if (id) { const acc = store.get(id); if (acc && acc.user && !tokenOk(acc, m.token)) id = null; }
      if (!id) id = newId();
      const old = byId.get(id);
      if (old && old !== ws) { conns.get(old) && (conns.get(old).code = null); try { old.close(); } catch {} }
      c.id = id; byId.set(id, ws);
      clearTimeout(graceTimers.get(id)); graceTimers.delete(id);
      send(ws, { t: "welcome", id, profile: profileView(store.ensure(id)) });
      send(ws, { t: "chatlog", ch: "lobby", list: lobbyLog });
      // 새로고침 후 원래 있던 방으로 복귀
      for (const r of rooms.values()) if (r.players.some((p) => p.id === id)) { c.code = r.code; send(ws, { t: "state", s: publicState(r) }); send(ws, { t: "chatlog", ch: "room", list: r.chat }); return; }
      send(ws, { t: "rooms", rooms: roomList() });
      return;
    }
    if (!c.id) return;
    const r = c.code ? rooms.get(c.code) : null;

    switch (m.t) {
      case "list": send(ws, { t: "rooms", rooms: roomList() }); break;
      case "create": {
        if (c.code) leave(ws);
        const code = newCode();
        const me = setNick(c.id, m.nick);
        const room = { code, status: "lobby", host: c.id, createdAt: Date.now(), players: [{ id: c.id, nick: me.nick, lv: levelInfo(me.exp).level, score: 0, out: false }],
          turn: 0, last: "", used: [], usedSet: new Set(), chain: [], limit: 15, deadline: 0, seq: 0, winner: null, note: "", noteId: null, timer: null, chat: [] };
        rooms.set(code, room); c.code = code;
        send(ws, { t: "chatlog", ch: "room", list: [] });
        broadcast(room); broadcastRooms();
        break;
      }
      case "join": {
        const code = String(m.code || "").toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) return send(ws, { t: "error", msg: "그런 방이 없어요." });
        if (room.players.some((p) => p.id === c.id)) { c.code = code; return broadcast(room); }
        if (room.status !== "lobby") return send(ws, { t: "error", msg: "이미 게임이 진행 중인 방이에요." });
        if (room.players.length >= MAX_PLAYERS) return send(ws, { t: "error", msg: "방이 꽉 찼어요." });
        if (c.code) leave(ws);
        const me = setNick(c.id, m.nick);
        room.players.push({ id: c.id, nick: me.nick, lv: levelInfo(me.exp).level, score: 0, out: false });
        c.code = code; broadcast(room); broadcastRooms();
        send(ws, { t: "chatlog", ch: "room", list: room.chat });
        roomSystem(room, `${me.nick} 님이 들어왔어요.`);
        break;
      }
      case "leave": leave(ws); break;
      case "chat": {
        const text = String(m.text || "").replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e]/g, " ").trim().slice(0, 200);
        const now = Date.now();
        if (!text || now - (c.lastChat || 0) < 700) return;
        c.lastChat = now;
        const msg = chatMsg(c.id, text);
        if (r) { pushLog(r.chat, msg); for (const p of r.players) send(byId.get(p.id), { t: "chat", ch: "room", m: msg }); }
        else { pushLog(lobbyLog, msg); for (const [w, cc] of conns) if (cc.id && !cc.code) send(w, { t: "chat", ch: "lobby", m: msg }); }
        break;
      }
      case "signup": {
        if (c.code) return send(ws, { t: "autherr", msg: "방에서 나온 다음에 가입해 주세요." });
        const user = String(m.user || "").trim().toLowerCase(), pw = String(m.pw || "");
        if (!USER_RE.test(user)) return send(ws, { t: "autherr", msg: "아이디는 영어 소문자, 숫자, _ 로 3~16자예요." });
        if (pw.length < 4 || pw.length > 64) return send(ws, { t: "autherr", msg: "비밀번호는 4자 이상이에요." });
        if (store.findUser(user)) return send(ws, { t: "autherr", msg: "이미 있는 아이디예요." });
        let p = store.ensure(c.id);
        if (p.user) return send(ws, { t: "autherr", msg: "로그아웃한 다음에 새로 가입해 주세요." });
        // 손님으로 쌓은 기록을 그대로 새 계정으로 옮겨요
        p.user = user; p.salt = crypto.randomBytes(16).toString("hex"); p.pwHash = hashPw(pw, p.salt);
        const nick = cleanNick(m.nick, ""); if (nick) p.nick = nick;
        send(ws, { t: "auth", id: p.id, token: issueToken(p), msg: "가입했어요!" });
        break;
      }
      case "login": {
        if (c.code) return send(ws, { t: "autherr", msg: "방에서 나온 다음에 로그인해 주세요." });
        c.tries = (c.tries || 0) + 1;
        if (c.tries > 8) return send(ws, { t: "autherr", msg: "너무 많이 시도했어요. 새로고침 후 다시 해 주세요." });
        const p = store.findUser(String(m.user || "").trim().toLowerCase());
        if (!p || !checkPw(p, String(m.pw || ""))) return send(ws, { t: "autherr", msg: "아이디나 비밀번호가 맞지 않아요." });
        send(ws, { t: "auth", id: p.id, token: issueToken(p), msg: "로그인했어요!" });
        break;
      }
      case "logout": {
        const p = store.get(c.id);
        if (p && p.user && tokenOk(p, m.token)) { p.tokens = p.tokens.filter((t) => t !== sha(m.token)); store.save(p); }
        send(ws, { t: "auth", id: null, token: null, msg: "로그아웃했어요." });
        break;
      }
      case "nick": { const me = setNick(c.id, m.nick); send(ws, { t: "profile", profile: profileView(me) }); break; }
      case "top": send(ws, { t: "top", list: topList(), me: profileView(store.ensure(c.id)) }); break;
      case "solo": {
        // 봇 대전 결과: 브라우저가 보내는 값이라 상한을 둬요
        const d = SOLO[m.diff]; if (!d) return;
        const now = Date.now(); if (now - (lastSolo.get(c.id) || 0) < 15000) return;
        lastSolo.set(c.id, now);
        const words = Math.max(0, Math.min(200, Math.floor(Number(m.words) || 0)));
        const score = Math.max(0, Math.min(Math.floor(Number(m.score) || 0), words * 110, 5000));
        reward(c.id, score * d.mult + (m.win ? d.win : 0), { win: !!m.win, score });
        break;
      }
      case "start": {
        if (!r || r.status !== "lobby" || r.host !== c.id) return;
        if (r.players.length < 2) return send(ws, { t: "error", msg: "두 명 이상 있어야 시작할 수 있어요." });
        for (let i = r.players.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [r.players[i], r.players[j]] = [r.players[j], r.players[i]]; }
        r.players.forEach((p) => { p.score = 0; p.out = false; });
        const w = startWord();
        r.used = [w]; r.usedSet = new Set([w]); r.chain = [{ w, by: null }]; r.last = w; r.turn = 0; r.seq++;
        r.limit = multiLimit(r); r.deadline = Date.now() + 2500 + r.limit * 1000;
        r.status = "playing"; r.winner = null; r.note = "게임 시작!"; r.noteId = null;
        armTimer(r); broadcast(r); broadcastRooms();
        break;
      }
      case "word": {
        if (!r || r.status !== "playing") return;
        const p = r.players[r.turn];
        if (p.id !== c.id || p.out) return send(ws, { t: "error", msg: "지금은 내 차례가 아니에요." });
        if (Date.now() > r.deadline) return send(ws, { t: "error", msg: "시간이 지났어요." });
        const w = String(m.w || "").replace(/\s+/g, "");
        const need = alts(r.last.at(-1));
        let err = "";
        if (w.length < 2 || w.length > 30) err = "두 글자 이상 입력하세요.";
        else if (!/^[가-힣]+$/.test(w)) err = "완성된 한글만 입력할 수 있어요.";
        else if (!need.includes(w[0])) err = `‘${need.join("’ 또는 ‘")}’(으)로 시작해야 해요.`;
        else if (r.usedSet.has(w)) err = "이미 나온 단어예요.";
        else if (!dict.has(w)) err = `‘${w}’은(는) 사전에 없는 단어예요.`;
        if (err) return send(ws, { t: "error", msg: err });
        const left = Math.max(0, r.deadline - Date.now()) / 1000;
        const pts = w.length * 10 + Math.ceil(left) * 2;
        p.score += pts;
        r.used.push(w); r.usedSet.add(w); r.chain.push({ w, by: c.id }); r.last = w; r.seq++; r.note = ""; r.noteId = null;
        r.turn = nextAlive(r); r.limit = multiLimit(r); r.deadline = Date.now() + r.limit * 1000;
        armTimer(r); broadcast(r);
        send(ws, { t: "ok", pts });
        break;
      }
      case "typing": {
        if (!r || r.status !== "playing" || r.players[r.turn].id !== c.id) return;
        const v = String(m.v || "").slice(0, 20);
        for (const p of r.players) if (p.id !== c.id) send(byId.get(p.id), { t: "typing", id: c.id, v });
        break;
      }
      case "rematch": {
        if (!r || r.status !== "over" || r.host !== c.id) return;
        // 연결이 끊긴 사람은 빼고 다시 대기실로
        r.players = r.players.filter((p) => byId.has(p.id) && conns.get(byId.get(p.id))?.code === r.code);
        r.players.forEach((p) => { p.score = 0; p.out = false; });
        r.status = "lobby"; r.chain = []; r.used = []; r.usedSet = new Set(); r.last = ""; r.seq++; r.note = ""; r.noteId = null; r.createdAt = Date.now();
        broadcast(r); broadcastRooms();
        break;
      }
    }
  });
  ws.on("close", () => {
    const c = conns.get(ws);
    conns.delete(ws);
    if (!c || !c.id || byId.get(c.id) !== ws) return;
    byId.delete(c.id);
    if (!c.code) return;
    const code = c.code, id = c.id;
    // 새로고침 대비 10초 유예 후 방에서 제거
    graceTimers.set(id, setTimeout(() => {
      graceTimers.delete(id);
      if (byId.has(id)) return;
      const r = rooms.get(code);
      if (r) removePlayer(r, id);
    }, 10000));
  });
});

store.init().then(() => {
  server.listen(PORT, () => console.log(`우리끄투 서버 실행 중: http://localhost:${PORT}`));
}).catch((e) => { console.error("기록 저장소를 열지 못했어요:", e.message); process.exit(1); });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { store.flush(); process.exit(0); });
