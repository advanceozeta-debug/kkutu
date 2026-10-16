# 우리끄투

끄투 온라인의 오픈소스 사전으로 만든 끝말잇기 웹게임이에요. 혼자 봇이랑 연습하거나, 방을 만들어 친구들과 실시간으로 대결할 수 있어요.

- 사전: 약 35만 개 (원조 끄투 기준: 방언·옛말·문화어 포함, 어인정 제외 · 두음법칙 적용)
- 봇과 제시어는 표준어 명사 약 21만 개만 써요
- 봇 대전: 쉬움 · 보통 · 어려움(한방 단어로 공격)
- 멀티플레이: 4자리 방 코드, 2~8명, 상대가 입력 중인 글자 표시, 탈락제
- 점수: 글자 수 × 10 + 남은 초 × 2
- 경험치 · 레벨 · 전체 랭킹 (서버를 띄웠을 때)
- 회원가입 · 로그인 (아이디 + 비밀번호, 여러 기기에서 같은 기록)
- 채팅: 로비 전체 채팅, 방 안에서는 방 채팅

## 바로 하기

- 봇 대전 (GitHub Pages): https://advanceozeta-debug.github.io/kkutu/
- 친구 대전 + 랭킹 (Render): https://kkutu-ovae.onrender.com

## 서버 띄우기 (친구 대전)

GitHub Pages는 파일만 보여 주는 곳이라 `server.js` 가 돌지 않아요. 친구 대전을 하려면 Node.js를 돌려 주는 호스팅이 필요해요. 예: [Render](https://render.com)

1. Render에 GitHub 계정으로 로그인해요.
2. **New → Web Service** 를 누르고 이 저장소(`kkutu`)를 골라요.
3. Build Command `npm install`, Start Command `npm start` 로 두고 만들면 끝이에요.

### 경험치와 랭킹 저장

경험치, 전적, 닉네임은 서버에 저장돼요.

- 아무 설정이 없으면 `data/players.json` 파일에 저장해요. 그런데 Render 무료 서버는 다시 시작할 때 파일이 지워져서 기록이 사라질 수 있어요.
- 기록을 계속 남기려면 무료 PostgreSQL(예: [Neon](https://neon.tech), [Supabase](https://supabase.com))을 만들고, 그 접속 주소를 Render의 **Environment** 에 `DATABASE_URL` 이라는 이름으로 넣으세요. 표는 서버가 알아서 만들어요.

경험치 규칙
- 친구 대전: 그 판에서 얻은 점수 + 참가 10 + 우승하면 (인원 − 1) × 40
- 봇 대전: 점수 × 난이도 배율(쉬움 0.3, 보통 0.5, 어려움 0.8) + 이기면 보너스
- 레벨 L에서 다음 레벨까지 필요한 경험치: 100 × L^1.5

가입하지 않은 손님은 브라우저에 저장된 정보로 구분해서, 브라우저 기록을 지우면 기록이 사라져요. 회원가입하면 그동안 쌓은 기록이 계정으로 옮겨지고, 비밀번호는 scrypt로 암호화해서 저장해요.

서비스 이름을 짧게 지으면 주소도 짧아져요. 예: `kkutu-ovae.onrender.com`

GitHub Pages 화면에서도 친구 대전을 쓰고 싶으면, `index.html` 위쪽의 이 줄에 서버 주소를 적으세요.

```html
<meta name="kkutu-server" content="wss://kkutu-ovae.onrender.com">
```

## 내 컴퓨터에서 실행

[Node.js](https://nodejs.org) 18 이상이 필요해요.

```bash
npm install
npm start
```

브라우저에서 http://localhost:3000 을 열면 돼요.

## 파일 구성

| 파일 | 설명 |
| --- | --- |
| `index.html` | 게임 화면 + 단어 목록 (봇 대전은 이 파일만으로 동작) |
| `server.js` | 멀티플레이 서버 (방, 턴, 타이머, 단어 검증, 경험치) |
| `store.js` | 경험치 · 전적 저장 (PostgreSQL 또는 파일) |
| `package.json` | 서버 실행 설정 |

## 라이선스

단어 데이터는 [JJoriping/KKuTu](https://github.com/JJoriping/KKuTu) 의 `db.sql` 에서 원조 끄투가 인정하는 품사의 단어를 골라 만든 것이에요 (어인정 단어 제외). 원본이 GPL-3.0이므로 이 프로젝트도 GPL-3.0을 따라요. 자세한 내용은 `LICENSE` 를 보세요.
