# 마음의 보석함

하루의 감정을 보석으로 고르고 짧은 이야기를 남기는 반응형 감정 기록 웹앱입니다. 8가지 마음빛을 Russell의 감정 원형 모형에서 착안한 **쾌–불쾌 × 에너지 수준**으로 배치해, 날짜별 기록과 주간·월간 흐름을 함께 돌아볼 수 있습니다.

- 서비스: https://mood-jewel-diary.web.app
- 최종 기획: [PROJECT_PLAN.md](./PROJECT_PLAN.md)

## 주요 기능

- 월요일부터 일요일까지 표시되는 월간 달력
- 행복·설렘·평온·평범·복잡·우울·짜증·화남의 8가지 감정 보석
- 날짜별 감정과 100자 이내 메모 생성·수정·삭제
- 기록된 날짜의 감정 색상과 보석 표시
- 주간·월간 대표 보석, 감정별 횟수, 에너지 비율, 마음의 궤적
- 감정 필터와 기록한 메모 회고
- 브라우저 Web Speech API를 활용한 한국어 음성 받아쓰기
- Google 로그인과 사용자별 Firestore 동기화
- 로그인 전 브라우저 기록을 계정으로 가져오는 선택형 마이그레이션
- 모바일·데스크톱 반응형 UI와 WebMCP 기록 도구

## 데이터 저장 방식

- 로그아웃 상태에서는 기록을 현재 브라우저의 `localStorage`에 저장합니다.
- Google 로그인 상태에서는 사용자 UID 아래의 Firestore 문서로 저장합니다.
- 처음 로그인할 때 기존 브라우저 기록을 계정으로 가져올지 선택할 수 있습니다.
- 같은 날짜에는 하나의 기록만 존재하고, 기존 날짜를 다시 저장하면 수정됩니다.

## 음성 받아쓰기

`보석에 담긴 이야기` 옆의 **말로 쓰기** 버튼을 누르면 브라우저 내장 음성 인식이 한국어를 실시간으로 입력합니다. 별도의 OpenAI·Hugging Face API 또는 비밀 키를 사용하지 않습니다.

브라우저 지원 차이 때문에 최신 Chrome 또는 Edge를 권장합니다. 모바일 음성 인식이 이전 문장을 포함해 다시 보내더라도 겹치는 문구를 한 번만 남기도록 병합합니다.

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm install
npm run dev
```

기본 로컬 주소는 `http://127.0.0.1:5173`입니다.

## 검사와 빌드

```bash
npx tsc --noEmit --incremental false
npm run build
```

Firebase Hosting용 정적 결과물은 `dist/client`에 생성됩니다.

## Firebase 배포

Firebase 프로젝트는 `mood-jewel-diary`, Firestore 위치는 `asia-northeast3`를 사용합니다.

```bash
npm run build
npx firebase deploy --only hosting --project mood-jewel-diary
```

## 보안

- `.env*`, Firebase 로컬 상태, 빌드 결과물, 모든 `node_modules`는 Git에서 제외합니다.
- Hugging Face 및 OpenAI 비밀 키를 사용하거나 프론트엔드에 포함하지 않습니다.
- Firebase 웹 구성값은 클라이언트 식별용이며, 실제 데이터 접근은 로그인 UID를 검사하는 Firestore Security Rules로 제한합니다.
- 배포와 GitHub 업로드 전 비밀 키·비밀번호·개인정보 포함 여부를 다시 검사합니다.
