# 제로백스쿨 (ZERO100)

예비창업자·소상공인을 위한 **정부지원사업 매칭 · 사업계획서 · 발표자료 · 전문가 컨설팅** 플랫폼.

한 번 입력한 프로필로 매칭부터 사업계획서·발표자료 작성, 전문가 컨설팅 연계까지 하나의 흐름으로 이어집니다.

---

## 서비스 구조 — 7-Step 퍼널

| STEP | 화면 | 내용 |
|------|------|------|
| 1 | 프로필 입력 | 회원 가입 후 사업 기본정보·고객 세그먼트 입력 |
| 2 | 아이템 정의 | 아이템 개요·문제·실현성·차별화 정리, 아이템명 제안 |
| 3 | 전문 액셀러레이터 분석 | 5개 영역 진단(문제적합성·시장·창업자적합성·차별성·확장성) |
| 4 | 정부지원사업 매칭 | 세그먼트·단계·업종 규칙 기반 매칭 + 매칭 근거 |
| 5 | 사업계획서 | 4개 핵심 섹션(문제·실현성·성장·팀) 작성, hwpx 출력 |
| 6 | 발표 슬라이드 | 9장 구성의 IR 피치덱 초안 |
| 7 | 전문가 컨설팅 | 회원 컨텍스트를 첨부한 상담 신청(사업계획서 첨삭·발표 코칭 등) |

> 공개 랜딩에서 상담 신청을 받고, 회원 워크스페이스(`/app`)에서 7-Step 퍼널을 진행하며, 운영자는 어드민(`/admin`)에서 상담·컨설팅 신청을 관리합니다.

---

## 기술 스택

- **런타임**: Node.js ≥ 20
- **서버**: Express 4 (모놀리식, 단일 `server.js`)
- **DB**: PostgreSQL (`pg`) — 마이그레이션 기반 스키마 관리
- **세션/인증**: `express-session` + `connect-pg-simple`, 비밀번호 `bcryptjs` 해시
- **보안**: `helmet`(CSP 포함), `express-rate-limit`, `express-validator`, CSRF(Origin 검증 + SameSite 쿠키)
- **뷰**: 서버사이드 정적 HTML (`public/`, `views/`) — 프론트 프레임워크 없음
- **문서 변환**: hwpx 변환 마이크로서비스(`hwpx-service/`, Docker)
- **배포**: GCP Cloud Run (`Dockerfile`)

---

## 빠른 시작

```bash
# 1) 의존성 설치
npm install

# 2) 환경변수 설정
cp .env.example .env
#   DATABASE_URL / SESSION_SECRET / ADMIN_PASSWORD 등을 채웁니다.

# 3) DB 마이그레이션
npm run migrate

# 4) 실행
npm run dev      # 개발(자동 재시작)
npm start        # 운영
```

- 기본 포트: `8080` (env `PORT`)
- 공개 랜딩: `http://localhost:8080/`
- 회원 워크스페이스: `http://localhost:8080/app`
- 어드민: `http://localhost:8080/admin` (env `ADMIN_PASSWORD`)

### 로컬 DB(선택) — Docker

```bash
docker run -d --name zero100-pg -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=zero100 \
  -p 5432:5432 postgres:16-alpine
```

### hwpx 변환 서비스(선택, STEP5 hwpx 출력용)

```bash
cd hwpx-service
docker build -t zero100-hwpx .
docker run -d --name zero100-hwpx -p 8090:8090 zero100-hwpx
# .env 에 HWPX_SERVICE_URL=http://localhost:8090
```

---

## 디렉토리 구조

```
server.js                 # 백엔드 전체 (API · 라우팅 · 보안 미들웨어)
migrations/               # DB 스키마 마이그레이션 (001~004)
scripts/migrate.js        # 마이그레이션 러너 (npm run migrate)
public/
  index.html              # 공개 랜딩 + 상담 신청
  app.html                # 회원 워크스페이스 (STEP1~7 SPA)
  logo-zero100*.png       # 브랜드 로고
views/
  login.html              # 어드민 로그인
  admin.html              # 어드민 대시보드 (상담 / 컨설팅 신청)
hwpx-service/             # hwpx 변환 마이크로서비스 (Java, Docker)
doc/                      # 기획서 · PRD · 업그레이드 전략
Dockerfile                # Cloud Run 컨테이너
```

---

## 데이터베이스 마이그레이션

스키마는 `migrations/` 의 SQL 파일로 관리하며, `schema_migrations` 테이블에 적용 이력을 기록합니다.

| 파일 | 내용 |
|------|------|
| `001_init_submissions_admins.sql` | 상담 신청 · 관리자 |
| `002_users_profiles_sessions.sql` | 회원 · 고객 프로필 · 세그먼트 · 세션 |
| `003_programs_seed.sql` | 정부지원사업 정규 스키마 + 매칭 + 시드 |
| `004_item_analysis_plan_deck.sql` | 아이템 · 분석 · 사업계획서 · 발표자료 · 컨설팅 |

```bash
npm run migrate     # 미적용 마이그레이션을 순서대로 실행
```

---

## 보안

- **CSP**: 외부 리소스(폰트)만 허용하고 object/frame/외부 폼 전송 차단
- **세션**: HttpOnly · SameSite=Lax, 운영 환경 Secure 쿠키
- **인증**: 회원 비밀번호 bcrypt 해시, 어드민 세션 보호
- **입력 검증**: `express-validator` 화이트리스트, 저장·출력 단계 XSS 이스케이프
- **CSRF**: 상태 변경 요청 Origin 검증 + SameSite 쿠키 이중 방어
- **레이트 리밋**: 신청·로그인·인증 엔드포인트별 제한

자세한 배포 절차는 `GCP-배포-가이드.md` 를 참고하세요.
