# 가족 간병 기록 프론트엔드

HTML, CSS, 순수 JavaScript로 만든 가족 간병 기록용 프론트엔드입니다. 별도 빌드 없이 GitHub Pages에서 정적 파일로 실행할 수 있습니다.

## 파일 구조

```text
index.html
css/style.css
js/config.js
js/api.js
js/app.js
js/charts.js
README.md
```

## 로컬 실행

백엔드 FastAPI 서버를 먼저 실행한 뒤, 이 폴더에서 정적 서버를 띄웁니다.

```bash
python3 -m http.server 5500
```

브라우저에서 다음 주소를 엽니다.

```text
http://localhost:5500
```

처음 접속하면 가족 접근 키와 작성자 이름을 입력합니다. 가족 접근 키는 모든 API 요청의 `X-Family-Key` 헤더로 전송됩니다.

## 백엔드 주소 설정

기본 백엔드 주소는 [js/config.js](js/config.js)에 설정되어 있습니다.

```javascript
window.APP_CONFIG = {
  API_BASE_URL: "http://127.0.0.1:8000",
  POLL_INTERVAL_MS: 15000
};
```

FastAPI 주소가 바뀌면 `API_BASE_URL` 값을 수정하세요. 자동 새로고침 주기는 `POLL_INTERVAL_MS`로 조정할 수 있습니다.

## GitHub Pages 배포

1. 이 파일들을 GitHub 저장소의 루트에 올립니다.
2. GitHub 저장소에서 `Settings`로 이동합니다.
3. `Pages` 메뉴에서 배포 소스를 선택합니다.
4. 브랜치를 선택하고 폴더는 `/root`를 선택합니다.
5. 저장 후 표시되는 GitHub Pages 주소로 접속합니다.

GitHub Pages는 HTTPS 주소에서 실행됩니다. 로컬 FastAPI 서버(`http://127.0.0.1:8000`)와 통신하려면 브라우저의 혼합 콘텐츠 정책, CORS 설정, 네트워크 접근 가능 여부를 함께 확인해야 합니다. 실제 배포 환경에서는 HTTPS로 접근 가능한 백엔드 주소를 `js/config.js`에 설정하는 것이 좋습니다.

## 주요 기능

- 현재 상태 조회 및 저장
- 최근 활력징후 표시
- 활력징후 추가, 수정, 삭제
- Chart.js 기반 활력징후 그래프
- 이벤트 기록 추가, 수정, 삭제
- 치료 및 할 일 추가, 수정, 삭제, 완료, 취소
- 교대 인계 메모 저장 및 인계 내용 복사
- 전체 JSON 및 SQLite 백업 내려받기
- 15초 자동 새로고침, 탭 복귀 시 재조회, 수동 새로고침
