# GCP 배포 가이드 (비개발자용)

## 전체 흐름

```
내 컴퓨터 (코드) → GCP Cloud Run (서버) + Cloud SQL (PostgreSQL DB)
```

---

## 1단계: GCP 프로젝트 준비

### 1-1. Google Cloud Console 접속
→ https://console.cloud.google.com 에서 구글 계정으로 로그인

### 1-2. 새 프로젝트 생성
- 상단 프로젝트 선택 → "새 프로젝트"
- 프로젝트 이름: `iroun-start` (원하는 이름)
- 생성 후 **프로젝트 ID** 메모해두기 (예: `iroun-start-123456`)

### 1-3. 결제 계정 연결
- 신용카드 등록 필요 (무료 크레딧 $300 제공)

---

## 2단계: Google Cloud CLI 설치

터미널에서 아래 명령어 실행:

```bash
# Windows PowerShell에서 실행
(New-Object Net.WebClient).DownloadFile("https://dl.google.com/dl/cloudsdk/channels/rapid/GoogleCloudSDKInstaller.exe", "$env:Temp\GoogleCloudSDKInstaller.exe"); & $env:Temp\GoogleCloudSDKInstaller.exe
```

설치 후:
```bash
gcloud auth login          # 구글 계정 로그인
gcloud config set project YOUR_PROJECT_ID   # 프로젝트 설정
```

---

## 3단계: Cloud SQL (PostgreSQL) 생성

```bash
# Cloud SQL API 활성화
gcloud services enable sqladmin.googleapis.com

# PostgreSQL 인스턴스 생성 (약 5~10분 소요)
gcloud sql instances create iroun-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=asia-northeast3

# 비밀번호 설정
gcloud sql users set-password postgres \
  --instance=iroun-db \
  --password=YOUR_DB_PASSWORD

# 데이터베이스 생성
gcloud sql databases create iroun_db --instance=iroun-db
```

---

## 4단계: 테이블 생성 (마이그레이션)

이 프로젝트는 `migrations/` 폴더로 DB 스키마를 관리합니다 (`npm run migrate`).

**방법 A — SQL 직접 붙여넣기 (간단):**
```bash
gcloud sql connect iroun-db --user=postgres --database=iroun_db
```
접속 후 `migrations/001_init_submissions_admins.sql` → `migrations/002_users_profiles_sessions.sql` 내용을 **순서대로** 붙여넣어 실행합니다.

**방법 B — 마이그레이션 러너 (권장):**
Cloud SQL Auth Proxy로 로컬에서 DB에 연결한 뒤:
```bash
# .env 의 DATABASE_URL 을 프록시 경유로 설정 후
npm run migrate
```
이후 새 마이그레이션은 `migrations/00X_*.sql` 파일을 추가하고 `npm run migrate` 만 다시 실행하면 됩니다(적용 이력은 `schema_migrations` 테이블이 관리).

---

## 5단계: Cloud Run 배포

```bash
# Cloud Run + Container Registry API 활성화
gcloud services enable run.googleapis.com artifactregistry.googleapis.com

# 이미지 빌드 & 배포 (프로젝트 루트에서 실행)
cd "C:\Users\KOFST-NB011\Desktop\AI Project"

gcloud run deploy iroun-start \
  --source . \
  --region asia-northeast3 \
  --platform managed \
  --allow-unauthenticated \
  --add-cloudsql-instances YOUR_PROJECT_ID:asia-northeast3:iroun-db \
  --set-env-vars NODE_ENV=production \
  --set-env-vars ADMIN_PASSWORD=YOUR_ADMIN_PASSWORD \
  --set-env-vars SESSION_SECRET=YOUR_RANDOM_SECRET \
  --set-env-vars "DATABASE_URL=postgresql://postgres:YOUR_DB_PASSWORD@/iroun_db?host=/cloudsql/YOUR_PROJECT_ID:asia-northeast3:iroun-db"
```

배포 완료 후 URL이 출력됩니다:
```
Service URL: https://iroun-start-xxxxxxx-uc.a.run.app
```

---

## 6단계: 도메인 연결 (선택사항)

GCP Console → Cloud Run → 서비스 선택 → "도메인 매핑" 탭
→ 내 도메인 입력 → DNS 설정 안내대로 진행

---

## 비용 예상 (월)

| 서비스 | 예상 비용 |
|--------|---------|
| Cloud Run (소규모 트래픽) | 무료~$2 |
| Cloud SQL db-f1-micro | ~$8 |
| **합계** | **~$10/월** |

---

## 문제 해결

서버 로그 확인:
```bash
gcloud run logs read --service iroun-start --region asia-northeast3
```

