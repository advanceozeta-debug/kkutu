# 우리끄투

끄투 온라인의 오픈소스 사전으로 만든 끝말잇기 웹게임이에요. 혼자 봇이랑 연습하거나, 방을 만들어 친구들과 실시간으로 대결할 수 있어요.

- 사전: 명사 약 21만 개 (두음법칙 적용: 력 → 역, 녀 → 여, 라 → 나)
- 봇 대전: 쉬움 · 보통 · 어려움(한방 단어로 공격)
- 멀티플레이: 4자리 방 코드, 2~8명, 상대가 입력 중인 글자 표시, 탈락제
- 점수: 글자 수 × 10 + 남은 초 × 2

## 바로 하기

- 봇 대전 (GitHub Pages): https://advanceozeta-debug.github.io/kkutu/
- 친구 대전: 아래 "서버 띄우기"로 만든 주소

## 서버 띄우기 (친구 대전)

GitHub Pages는 파일만 보여 주는 곳이라 `server.js` 가 돌지 않아요. 친구 대전을 하려면 Node.js를 돌려 주는 호스팅이 필요해요. 예: [Render](https://render.com)

1. Render에 GitHub 계정으로 로그인해요.
2. **New → Web Service** 를 누르고 이 저장소(`kkutu`)를 골라요.
3. Build Command `npm install`, Start Command `npm start` 로 두고 만들면 끝이에요.

서비스 이름을 짧게 지으면 주소도 짧아져요. 예: `kkutu.onrender.com`

GitHub Pages 화면에서도 친구 대전을 쓰고 싶으면, `index.html` 위쪽의 이 줄에 서버 주소를 적으세요.

```html
<meta name="kkutu-server" content="wss://kkutu.onrender.com">
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
| `server.js` | 멀티플레이 서버 (방, 턴, 타이머, 단어 검증) |
| `package.json` | 서버 실행 설정 |

## 라이선스

단어 데이터는 [JJoriping/KKuTu](https://github.com/JJoriping/KKuTu) 의 `db.sql` 에서 표준어·외래어·전문어 명사만 골라 만든 것이에요. 원본이 GPL-3.0이므로 이 프로젝트도 GPL-3.0을 따라요. 자세한 내용은 `LICENSE` 를 보세요.
