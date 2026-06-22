# RentDesk (Windows · Mac 공용)

건물 임대관리 앱의 크로스플랫폼(Electron) 버전입니다. Mac판과 같은 데이터(`RentDesk/data.json`)를 사용합니다.

## 윈도우 설치파일(.exe) 만드는 법 — GitHub 클라우드 빌드

윈도우 PC가 없어도, GitHub의 무료 빌드 서비스로 설치파일을 만들 수 있습니다.

1. **GitHub 계정 만들기** (무료): https://github.com
2. **새 저장소(repository) 생성**: 우측 상단 `+` → `New repository` → 이름 입력(예: `rentdesk`) → `Create`
3. **소스 올리기**:
   - 같이 드린 `RentDesk-source.zip`을 풀어둔다.
   - 저장소 페이지에서 `Add file` → `Upload files` → 압축 푼 **모든 파일·폴더를 드래그**해서 올린다 → `Commit changes`
   - (`.github` 폴더가 꼭 함께 올라가야 합니다. 빌드 설정이 들어 있어요.)
4. **빌드 실행**: 저장소의 `Actions` 탭 → 왼쪽 `build` → `Run workflow` 버튼 클릭 → 몇 분 대기
5. **설치파일 내려받기**: 빌드가 끝나면(초록 체크) 그 실행 기록을 열고, 맨 아래 `Artifacts`에서 **`RentDesk-Windows-설치파일`**을 다운로드 → 압축 풀면 `RentDesk Setup 1.0.0.exe`

## 윈도우에서 설치
- `RentDesk Setup 1.0.0.exe` 실행 → 설치
- 처음 실행 시 "Windows의 PC 보호" 경고가 뜨면 → **추가 정보 → 실행** (서명 안 한 무료 배포라 그래요)
- 데이터 저장 위치: `%APPDATA%\RentDesk\data.json`

## 개발자용 (로컬 실행/빌드)
```
npm install
node node_modules/electron/install.js   # npm이 막을 경우 1회
npm start          # 실행
npm run dist:mac   # Mac dmg
npm run dist:win   # 윈도우(윈도우 PC에서)
```
