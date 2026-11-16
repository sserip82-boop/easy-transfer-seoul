# 쉬운환승 서울

index.html을 브라우저에서 엽니다. 설치와 API 키 없이 충무로역 3·4호선의 공식 환승 동선 8개를 확인할 수 있습니다.

routes.js는 프로젝트 output 폴더의 서울테스트_환승_공식원본.csv에서 서울교통공사 충무로역 행을 추출한 데이터입니다. 앱은 동선 순서와 탑승 횟수를 표시합니다. 현장 확인 및 공식 가동 상태 연동 전인 시연 버전입니다.

## 다음 개발 순서

1. 카카오 지도 SDK에 등록한 개발 주소에서 충무로역 지도를 표시하고, 좌표가 확인된 시설만 핀으로 표시합니다.
2. 서울 엘리베이터 위치 API와 가동현황 API에서 충무로역 설비를 조회하고, 같은 설비 한 대의 호기·위치·운행 층을 대조합니다.
3. 검증한 설비를 환승 단계에 연결하고 조회 시각을 표시합니다. 가상 고장과 공식 상태를 구별합니다.
4. 국토교통부 환승 API를 연결하고 장애 시 기준일이 표시된 공식 CSV를 사용합니다.

공식 출처: https://www.data.go.kr/data/15130556/fileData.do


## API 연결 실행

PowerShell에서 이 폴더를 열고 아래 명령으로 시작합니다. 키는 로컬 PowerShell에서만 입력합니다.

```powershell
$env:KAKAO_JS_KEY = Read-Host '카카오 JavaScript 키'
$env:SEOUL_OPEN_API_KEY = Read-Host '서울 열린데이터광장 인증키' -MaskInput
$env:KRIC_API_KEY = Read-Host 'KRIC 환승 이동경로 서비스 키' -MaskInput
node server.mjs
```

브라우저에서 http://localhost:4173 을 엽니다. 카카오 개발자 설정에서 해당 주소를 JavaScript SDK 도메인으로 등록합니다. 키 없이 실행하면 서울 API에는 공개 샘플을 요청하고 환승은 공식 CSV를 표시합니다.

1. 카카오 지도는 장소 검색으로 충무로역 중심을 찾습니다. 개별 시설 좌표는 확보 후 표시합니다.
2. 서울 위치 API는 getFcElvtr, 가동현황 API는 SeoulMetroFaciInfo를 사용합니다. 공식 안내의 HTTP 주소는 로컬 서버에서 호출합니다. 배포 전 인증키 전송과 제공 조건을 확인합니다. 위치와 상태의 역 코드와 시설명이 정확히 일치하는 유일한 경우에만 상태를 붙입니다.
3. KRIC은 공식 충무로 예제 요청으로 응답을 점검합니다. 방향·경로 검증 전까지 화면의 환승 단계는 공식 CSV를 사용합니다.

- 카카오 https://apis.map.kakao.com/web/guide/
- 서울 위치 https://data.seoul.go.kr/dataList/OA-22725/A/1/datasetView.do
- 서울 상태 https://data.seoul.go.kr/dataList/OA-15994/A/1/datasetView.do
- KRIC https://openapi.kric.go.kr/rips/M_01_02/intro.do?lcd=D

## 출입구 임시폐쇄 공사현황

기존 서울시 일반 인증키로 TbSubwayLineDetail을 조회합니다. 충무로 공사 공지가 있으면 폐쇄 장소, 기간, 사유와 공사 안내문의 대체 경로를 표시합니다. 공지 0건은 API 조회 결과이며 현장 개방 여부를 보장하지 않습니다.

공식 자료 https://data.seoul.go.kr/dataList/OA-22122/A/1/datasetView.do

## Gemini 문장 검색

Google AI Studio(https://aistudio.google.com/apikey)에서 발급한 키를 같은 PowerShell 창에 설정하고 서버를 다시 실행합니다.

```powershell
$env:GEMINI_API_KEY = Read-Host 'Gemini API 키'
node server.mjs
```

앱에서 AI 검색 버튼을 눌렀을 때만 질문을 Gemini에 보냅니다. 키가 없거나 응답에 문제가 있으면 기존 문장 검색으로 처리합니다. 기본 모델은 gemini-3.5-flash이며 필요한 경우 GEMINI_MODEL로 지정합니다.

## 서버 없이 면접 시연

인터넷이나 서버 연결이 끊기면 파일 탐색기에서 이 폴더의 index.html을 더블클릭합니다. 브라우저에 ‘오프라인 시연’이 표시되면 환승역과 방향을 선택합니다. 이 화면은 국토교통부 공식 CSV에서 가져온 충무로·불광·신당 동선을 표시합니다.

## GitHub Pages 포트폴리오 시연

이 앱 폴더를 별도의 GitHub 저장소에 올립니다. 저장소 Settings → Pages에서 Deploy from a branch를 선택하고 main, /(root)를 지정합니다. 제공되는 github.io 주소에서는 공식 CSV 환승 안내와 충무로 7번 출입구 가상 고장 시연이 열립니다. 카카오맵, 서울시 조회, Gemini까지 실행하는 공개 버전은 Node.js 서버를 지원하는 별도 호스팅과 서버 환경변수 설정이 필요합니다. 개인 API 키를 저장소에 넣지 않습니다.

## 전체 기능 공개 배포

Vercel에서 이 저장소를 Import한다. 저장소의 vercel.json이 화면 파일과 Node.js API를 배포한다.

Vercel 프로젝트의 Environment Variables에서 Production에 다음 값을 등록한다.

- KAKAO_JS_KEY — 카카오 JavaScript 키. 카카오 개발자 콘솔에서 실제 배포 주소를 JavaScript SDK 도메인으로 등록한다.
- SEOUL_OPEN_API_KEY — 서울 열린데이터광장 일반 인증키.
- GEMINI_API_KEY — Gemini API 키.
- KRIC_API_KEY — KRIC 환승 예제 조회가 필요한 경우만 설정.

변수를 저장한 후 재배포한다. 공개 주소에서 혜화 시설 목록·가동 상태, 카카오 지도, Gemini AI 검색을 차례로 확인한다. GitHub Pages에는 정적 시연 화면이 제공된다.
