// 플레이어 기록 저장소: 경험치, 전적, 닉네임
// DATABASE_URL 환경변수가 있으면 PostgreSQL에, 없으면 data/players.json 파일에 저장해요.
"use strict";
const fs = require("fs");
const path = require("path");

const FILE = process.env.DATA_FILE || path.join(__dirname, "data", "players.json");

// 레벨 L에서 L+1로 가는 데 필요한 경험치
const need = (L) => Math.round(100 * Math.pow(L, 1.5));
function levelInfo(exp) {
  let L = 1, rem = exp;
  while (rem >= need(L) && L < 999) { rem -= need(L); L++; }
  return { level: L, cur: rem, need: need(L) };
}

function createStore() {
  const players = new Map();
  const byUser = new Map(); // 로그인 아이디 -> 플레이어
  let pool = null, timer = null;

  async function init() {
    if (process.env.DATABASE_URL) {
      const { Pool } = require("pg");
      const local = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
      pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false } });
      await pool.query("CREATE TABLE IF NOT EXISTS kkutu_players (id TEXT PRIMARY KEY, data JSONB NOT NULL, exp INTEGER NOT NULL DEFAULT 0)");
      const { rows } = await pool.query("SELECT data FROM kkutu_players");
      for (const r of rows) players.set(r.data.id, r.data);
      for (const p of players.values()) if (p.user) byUser.set(p.user, p);
      console.log(`DB에서 플레이어 ${players.size}명 불러옴`);
    } else {
      try { for (const p of JSON.parse(fs.readFileSync(FILE, "utf8"))) { players.set(p.id, p); if (p.user) byUser.set(p.user, p); } } catch { /* 처음 실행 */ }
      console.log(`파일(${FILE})에서 플레이어 ${players.size}명 불러옴`);
    }
  }

  function flush() {
    if (pool) return;
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE + ".tmp", JSON.stringify([...players.values()].filter((p) => p.games > 0 || p.user)));
      fs.renameSync(FILE + ".tmp", FILE);
    } catch (e) { console.error("기록 저장 실패:", e.message); }
  }

  function save(p) {
    p.updated = Date.now();
    players.set(p.id, p);
    if (p.user) byUser.set(p.user, p);
    if (pool) {
      pool.query("INSERT INTO kkutu_players (id, data, exp) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, exp = EXCLUDED.exp", [p.id, p, p.exp])
        .catch((e) => console.error("DB 저장 실패:", e.message));
    } else {
      clearTimeout(timer);
      timer = setTimeout(flush, 2000);
    }
  }

  // 처음 온 사람은 기록 없이 만들어 두고, 실제로 게임을 해야 저장해요
  function ensure(id) {
    let p = players.get(id);
    if (!p) {
      p = { id, nick: "끄투러" + String(1000 + Math.floor(Math.random() * 9000)), exp: 0, wins: 0, games: 0, best: 0, created: Date.now() };
      players.set(id, p);
    }
    return p;
  }

  const ranked = () => [...players.values()].filter((p) => p.games > 0);
  function top(n) { return ranked().sort((a, b) => b.exp - a.exp || a.created - b.created).slice(0, n); }
  function rankOf(p) {
    if (!p.games) return null;
    let r = 1;
    for (const q of players.values()) if (q.games > 0 && (q.exp > p.exp || (q.exp === p.exp && q.created < p.created))) r++;
    return r;
  }

  const get = (id) => players.get(id);
  const findUser = (user) => byUser.get(user);
  return { init, ensure, get, findUser, save, top, rankOf, flush };
}

module.exports = { createStore, levelInfo };
