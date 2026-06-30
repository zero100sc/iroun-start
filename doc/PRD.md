# 제로백스쿨 PRD — AI 정부지원사업 풀퍼널 플랫폼

> **Product Requirements Document v1.0**
> 방법론: **DDD**(Domain-Driven Design) · **SDD**(Spec-Driven Development) · **TDD**(Test-Driven Development)
> 기반 문서: `(클로드)제로백스쿨_서비스구축기획서` + `(GPT)제로백스쿨_정부지원사업 매칭·작성·발표 AI 플랫폼 기획서`
> 브랜드명: **제로백스쿨 (ZERO100)** · 현재 운영 사이트(1차): `iroun-start-654878784545.asia-northeast3.run.app`
> ※ `iroun-start`는 **코드 저장소·패키지·배포 URL의 기술 식별자**일 뿐이며, 제품/브랜드명은 **제로백스쿨**로 통일한다(혼동 금지).

---

## 이 문서의 읽는 법 (방법론 통합 구조)

본 PRD는 세 방법론을 **하나의 추적 가능한 사슬**로 엮는다. 모든 기능은 아래 4단을 통과한다.

```
DDD            SDD                         TDD
도메인 모델  →  명세 + 수용 기준(AC)     →  테스트 케이스(Given/When/Then)
(2장)          (5장, STEP별)               (6장, AC를 1:1 테스트로 환원)
```

- **DDD(2장):** 유비쿼터스 언어 → 바운디드 컨텍스트 → 애그리거트/엔티티/값객체 → 도메인 이벤트 → 상태머신. *“무엇이 도메인인가”*를 먼저 못 박는다.
- **SDD(5장):** 각 기능을 `User Story → 명세 → API 계약 → 데이터 스키마 → 수용 기준(AC)` 으로 기술한다. **AC가 곧 구현 완료의 정의(DoD)** 다.
- **TDD(6장):** 모든 AC에는 `AC-x.y` ID가 붙고, 6장에서 동일 ID의 테스트(`TC-x.y`)로 환원된다. **테스트가 통과해야 AC가 충족된 것**으로 본다.
- **추적성 규칙:** `User Story(US-…) → 명세 → AC-… → TC-…` 가 끊기지 않아야 한다. 추적 매트릭스는 6.5에 둔다.

---

# 0. 문서 개요

## 0.1 목적

「제로백스쿨」 1차 랜딩페이지(상담신청 폼 중심)를 고도화하여,

> **고객 정보 입력 → 아이템 정의 → 액셀러레이터 진단 → 정부지원사업 매칭 → 사업계획서 자동작성 → 발표 슬라이드 자동작성 → 전문가 컨설팅 연계**

로 이어지는 **‘AI 자동화 6단계 + 휴먼 컨설팅 1단계’ 풀퍼널 플랫폼**을 구축한다. 본 문서는 프론트/백엔드/AI/QA 팀이 별도 회의 없이도 **도메인 경계, 데이터 모델, 기능 명세, 수용 기준, 테스트 기준, 외부 연동, AI 파이프라인, 과금 모델**을 일관되게 구현할 수 있도록 작성한다.

## 0.2 제품 한 줄 정의

> 공식 포털(K-Startup·기업마당·중소벤처24·IRIS)이 **정보 허브**라면, 제로백스쿨은 **“당신의 상황에 맞는 사업을 선별하고, 합격 가능한 서류·발표자료까지 만들어 주는 실행 허브”** 다.

## 0.3 범위 (In / Out)

| 구분 | 포함(In Scope) | 제외(Out of Scope, 백로그) |
|---|---|---|
| 핵심 | STEP 1~7 풀퍼널, 9개 세그먼트, 마이페이지, 과금 | 신규 공고 크롤러 자체 개발(기존 시스템 연동만) |
| AI | 아이템명 생성, 액셀러레이터 분석, 매칭 스코어링, 사업계획서/슬라이드 생성(RAG) | 자동 신청서 전자제출(공식 포털 직접 제출) |
| 문서 | docx/pdf/pptx 출력 | hwp 변환(별도 검토 항목) |
| 운영 | 전문가 컨설팅 연계, 알림 | 자체 결제 PG 개발(외부 PG 연동만) |

## 0.4 1차 → 2차 변경 포인트

| 구분 | 1차(현재) | 2차(본 PRD) |
|---|---|---|
| 핵심 기능 | 정적 소개 + 상담 신청 폼(리드 수집) | 고객 데이터 기반 AI 매칭·문서 자동생성 SaaS |
| 고객 분류 | 예비창업자/소상공인 2트랙 | **9개 세그먼트** |
| 전환 방식 | 폼 제출 → 컨설턴트 수동 연락 | 로그인 → 단계별 AI 자가진행 → 필요 시 컨설팅 |
| 핵심 가치 | ‘대신 찾아드립니다’(정보) | ‘AI가 매칭·작성, 전문가가 마무리’(실행 자동화) |
| 수익 | 무료 리드 → 유료 컨설팅 | STEP1~6 개별/패키지 구독 + STEP7 컨설팅 **투트랙** |

## 0.5 1차 자산 보존 원칙

기존 `server.js`(Express 4) / `views/` / `public/` / `schema.sql`의 **마케팅 자산(성과 수치·신뢰 요소·상담폼 UX)은 유지**하고, 그 위에 AI 자동화 레이어를 얹는다. 기존 `submissions`·`admins` 테이블은 STEP7(컨설팅 신청)과 어드민의 출발점으로 **계승**한다.

---

# 1. 제품 목표 · 페르소나 · 성공지표

## 1.1 목표 (OKR 형)

- **O1. 리드를 “제품 사용자”로 전환한다.** — KR: 진단 완주율, 프로필 완성률.
- **O2. 매칭의 신뢰를 만든다(설명 가능성).** — KR: 매칭 결과 클릭률, 관심공고 저장률.
- **O3. 문서 생성을 매출로 연결한다.** — KR: 사업계획서 유료 전환율, 고객당 문서 생성수.
- **O4. 합격·수혜라는 실질 성과로 닫는다.** — KR: 최종 제출률, 선정률, 고객 LTV.

## 1.2 페르소나 — 9개 고객 세그먼트 (유비쿼터스 언어의 일부)

| 코드 | 세그먼트 | 정의 | 핵심 니즈 |
|---|---|---|---|
| `PRE` | 예비창업자 | 사업자등록 전, 아이디어 단계 | 예창패 자격, 사업자등록 타이밍 |
| `EARLY` | 기창업자(3년 이내) | 창업 후 3년 미만 | 초기창업패키지 등 성장자금 |
| `SMB` | 소상공인 | 상시근로자 5인(제조 10인) 미만 | 정책자금 저금리, 디지털전환 |
| `YOUTH` | 청년창업자 | 만 39세 이하 | 청년창업사관학교 등 |
| `SENIOR` | 중장년창업자 | 만 40세 이상(퇴직 연계) | 중장년 기술창업센터 |
| `WORKER` | 직장인창업자 | 재직 중 부업/예비 | 사업자 전 신청 가능 여부, 겸업 리스크 |
| `WOMAN` | 여성창업자 | 여성(공동)대표 | 여성창업패키지, 여성기업 인증 |
| `LOAN` | 정책자금 문의자 | 융자·보증 수요 | 소진공 정책자금, 신·기보 특례보증 |
| `RND` | R&D 참여자 | 기술개발 과제 수행/예정 | TIPS·디딤돌·중기부 R&D, 기술성평가 |

> **설계 전제:** 세그먼트는 **다중 선택**이다(예: `YOUTH`+`EARLY`+`WOMAN`). 매칭 가중치 로직이 이 조합에 직접 의존한다. 또한 세그먼트는 **하드코딩 금지 — 마스터 테이블(코드성)** 로 관리한다(향후 사회적기업·소셜벤처 확장 대비).

## 1.3 KPI 체계 (퍼널 단계별)

| 퍼널 위치 | 핵심 지표 |
|---|---|
| 진입(STEP1) | 회원가입 전환율, 진단 완주율, 프로필 완성률 |
| 매칭(STEP4) | 매칭 결과 클릭률, 추천공고 저장률 |
| 작성(STEP5) | 초안 생성 성공률, 섹션 재생성 비율, 전문가 수정시간 감소율, **유료 전환율** |
| 발표/성과(STEP6~7) | 슬라이드 생성률, 서류→발표 전환율, 최종 제출률, **선정률**, LTV |

> 초기 KPI는 **트래픽보다 작업흐름 전환율**이 우선. 최종적으로는 “좋은 문서를 몇 건 만들었나”보다 **“실제 선정·수혜로 얼마를 연결했나”** 를 북극성 지표로 삼는다.

---

# 2. DDD — 도메인 설계

## 2.1 유비쿼터스 언어 (Glossary)

> 화면·코드·DB·문서·AI 프롬프트·CS 스크립트에서 **동일 용어를 동일 의미로** 쓴다. 영문은 코드 식별자 기준.

| 한글 용어 | 코드 식별자 | 정의 / 불변식 |
|---|---|---|
| 회원 | `User` | 인증 주체. 1 User : 1 Profile. |
| 고객 마스터 프로필 | `Profile` | STEP1 산출물. 모든 하위 단계의 1차 데이터 소스. **1회 입력, 전 단계 재사용**. |
| 세그먼트 | `Segment` | 9종 코드. 다중 부여 가능. 매칭 1차 필터·가중치 키. |
| 사업아이템 | `Item` | STEP2 산출물. 개요/문제인식/실현가능성/차별화전략(정확히 3개). |
| 아이템명 제안 | `ItemNameSuggestion` | AI 생성 3안(기술중심/혜택중심/문제중심). 1개 `selected`. |
| 액셀러레이터 분석 | `AcceleratorAnalysis` | STEP3 진단 리포트(5영역 점수 + 강점/보완 Top3). **대외 표기 고정**(아래 ⚠ 참조). |
| 공고 | `Program` | 정부지원사업 1건. 외부 크롤링 → canonical schema로 정규화된 로컬 캐시. |
| 자격규칙 | `EligibilityRule` | 공고의 정형 자격조건(업종/지역/연차/연령/규모/중복수혜). 하드필터 입력. |
| 매칭 결과 | `MatchResult` | (Profile × Program) 단위. `hardFilterPass` + `score(0~100)` + `scoreBreakdown` + **근거(evidence)**. |
| 지원 건 | `Application` | (User × Program) 단위의 **작업 애그리거트 루트**. 사업계획서·슬라이드·컨설팅·제출상태를 묶는다. |
| 사업계획서 | `BusinessPlan` | Application 1건당 1개. `Section[]` 으로 구성. |
| 섹션 | `PlanSection` | 사업계획서의 평가항목 단위 생성/재생성 최소 단위. 독립 버전 보유. |
| 발표 슬라이드 | `PitchDeck` | BusinessPlan과 1:1. `Slide[]`. |
| 지식자료 | `KnowledgeDoc` | 사전 학습 MD/스킬(합격 템플릿·노하우). RAG 검색 대상. |
| 컨설팅 신청 | `ConsultingRequest` | STEP7. 1차 상담폼 계승 + 전체 컨텍스트 첨부. |
| 결제/구독 | `Order` / `Subscription` | Freemium 게이팅 해제 단위. |
| 매칭률 | `matchScore` | 0~100(%). “왜”를 동반하지 않는 단독 숫자 노출 금지(2.6 정책). |

### ⚠ 명칭 규칙 (전 부서 강제) — 액셀러레이터 분석

- **내부 참조 모델:** Y Combinator 평가 프레임워크(코드네임 `GStack`)를 **시스템 프롬프트 내부 참조**로만 사용.
- **대외 노출 절대 금지:** 화면 UI·생성 문서(PDF/리포트)·마케팅 카피·CS 스크립트 어디에도 `YC`/`GStack` 명칭 **노출 금지**.
- **대외 표기 고정:** **‘전문 액셀러레이터 분석’** 또는 **‘글로벌 스타트업 액셀러레이터 진단 방법론’** 으로만 통일.
- **기술적 강제:** AI 출력 **후처리 필터**가 금지 토큰을 차단한다. → 이 규칙은 테스트(TC-3.x)로 검증한다.

## 2.2 바운디드 컨텍스트 & 컨텍스트 맵

도메인을 **Core / Supporting / Generic** 으로 분류한다.

| # | 바운디드 컨텍스트 | 분류 | 책임 | 대응 STEP |
|---|---|---|---|---|
| C1 | **Identity & Access** | Generic | 회원가입·로그인·세션·세그먼트 선택 | 진입 |
| C2 | **Profiling** | Core(공유 핵) | 고객 마스터 프로필(STEP1) | STEP1 |
| C3 | **Item Definition** | Core | 아이템 정의 + AI 아이템명(STEP2) | STEP2 |
| C4 | **Diagnosis** | Core | 액셀러레이터 분석(STEP3) | STEP3 |
| C5 | **Program Catalog** | Supporting | 외부 크롤링 → 정규화 캐시(공고) | STEP4 전제 |
| C6 | **Matching** | **Core(중심)** | 하드필터 + 적합도 스코어 + 근거 | STEP4 |
| C7 | **Plan Authoring** | **Core(매출 핵)** | 사업계획서 생성·편집(STEP5) | STEP5 |
| C8 | **Pitch Deck** | Core | 발표 슬라이드 생성(STEP6) | STEP6 |
| C9 | **Consulting** | Supporting | 전문가 업셀(STEP7) | STEP7 |
| C10 | **Billing** | Supporting | 결제·구독·Freemium 게이팅 | 횡단 |
| C11 | **Notification** | Generic | 마감 D-day·생성완료·매칭 알림 | 횡단 |
| C12 | **Knowledge & AI Orchestration** | Supporting | RAG·스킬·프롬프트·근거추적·출력필터 | C3·C4·C7·C8 지원 |
| C13 | **Document Vault** | Generic | 산출물 버전·다운로드 이력·감사로그 | 횡단 |

### 컨텍스트 맵(관계)

```
                          ┌──────────────────────────────┐
   [외부 크롤링 시스템] ──ACL──▶  C5 Program Catalog       │
                          └───────────────┬──────────────┘
                                          │ (정규화된 Program 제공)
 C2 Profiling ──(Shared Kernel: Profile)──┼─────────────┐
   │  └─upstream(공급자) → C3,C4,C6,C7,C8 가 Profile 소비 │
   ▼                                      ▼             ▼
 C3 Item Def ──▶ C4 Diagnosis ──▶ C6 Matching ──▶ C7 Plan Authoring ──▶ C8 Pitch Deck
                                          │                 │               │
                                          └───▶ C9 Consulting◀──────────────┘
   C12 Knowledge&AI ──(Open Host Service)── C3·C4·C7·C8 에 생성/근거 제공
   C10 Billing ──(게이팅)── 모든 다운로드/전체생성   C11 Notification ── 도메인 이벤트 구독
```

**핵심 관계 패턴**
- **ACL(Anti-Corruption Layer):** 외부 크롤링 시스템 ↔ C5. 외부 스키마를 **canonical schema(5장·7장)** 로 번역. 외부 포맷 변경이 내부로 새지 않게 격리한다.
- **Shared Kernel:** `Profile`(C2)은 하류 다수 컨텍스트가 공유하는 핵. 변경 시 영향 범위가 크므로 **버전·하위 단계 재계산 이벤트**로 관리.
- **Open Host Service:** C12(AI 오케스트레이션)는 표준 인터페이스(생성·근거반환·필터)를 노출하여 생성형 컨텍스트들이 동일 방식으로 소비.
- **Customer/Supplier:** C2→(C3,C4,C6,C7,C8) 상·하류. 상류 변경은 하류 수용 기준을 깨면 안 된다(계약 테스트로 보호).

## 2.3 애그리거트 · 엔티티 · 값객체

> 애그리거트 = 일관성 경계. **루트를 통해서만** 내부에 접근하고, 트랜잭션은 애그리거트 1개 단위.

| 애그리거트 루트 | 포함 엔티티 | 값객체(VO) | 불변식(Invariant) |
|---|---|---|---|
| `Profile` | ProfileBusiness, Patent[], FundingHistory[], FundingCurrent[] | `IndustryCode`(표준산업분류), `Region`(시도-시군구), `RevenueBand`, `SegmentSet`(1개 이상) | 세그먼트 ≥1; IndustryCode는 매칭 API 코드체계와 **동일 코드맵** 사용 |
| `Item` | ItemOverview, ItemProblem, ItemFeasibility, ItemDifferentiation, ItemNameSuggestion[] | `DifferentiationStrategies`(정확히 3개), `Milestones`(JSON) | 차별화 전략 **정확히 3개**(미만→진행 차단, 4번째 추가 불가); 제안 중 `selected`는 0 또는 1개 |
| `AcceleratorAnalysis` | AnalysisComment[] | `FiveAreaScore`(5×[0..5]), `StrengthTop3`, `GapTop3` | 5개 영역 점수 모두 존재; 출력에 금지 토큰(YC/GStack) **불포함** |
| `Program` | EvaluationItem[], RequiredDoc[] | `EligibilityRule`, `ApplicationPeriod`, `FundingType`, `MaxAmount`, `NormalizedTags` | `program_id` 유일; period_end ≥ period_start |
| `MatchResult` | — | `ScoreBreakdown`(요소별%), `EvidenceChip[]` | score∈[0,100]; hardFilterPass=false ⇒ 리스트 제외 또는 0% |
| `Application` | BusinessPlan, PitchDeck, ConsultingRequest 참조 | `ApplicationStatus`(상태머신) | (User,Program) 유일; 상태 전이는 2.5 규칙만 허용 |
| `BusinessPlan` | PlanSection[] | `SectionVersion`, `CharLimit` | 1 Application : 1 Plan; 섹션은 독립 재생성(타 섹션 불변) |
| `PitchDeck` | Slide[] | `SlideType`, `VisualSuggestion`, `Theme` | 1 BusinessPlan : 1 Deck |
| `Order` | OrderLine[] | `Money`, `EntitlementScope` | 결제 완료 이벤트로만 게이팅 해제 |

> **1 고객 : N 사업계획서** — `BusinessPlan`은 **공고(Program) 단위로 N개** 생성 가능. 그래서 `Application`을 작업 애그리거트 루트로 두어 “어떤 공고를 위한 작업인가”를 일관성 경계로 삼는다.

## 2.4 도메인 이벤트

> 컨텍스트 간 결합을 낮추기 위해 상태 변화는 이벤트로 발행한다. Notification·Billing·Analytics가 구독한다.

| 이벤트 | 발행 컨텍스트 | 주요 구독자 | 비고 |
|---|---|---|---|
| `ProfileCompleted` | C2 | C6(매칭 사전계산), Analytics | 프로필 완성률 KPI |
| `ProfileUpdated` | C2 | C3·C4·C6(재계산), C11(알림) | **하위 단계 재계산 트리거** |
| `ItemNameSelected` | C3 | C4, C7 | 서사 기준 확정 |
| `AnalysisGenerated` | C4 | C6, Document Vault | 버전 이력 |
| `ProgramSynced` | C5 | C6(증분 재매칭) | 배치/웹훅 |
| `MatchCalculated` | C6 | UI, C11 | 신규 매칭 알림 |
| `PlanSectionGenerated` | C7 | UI(점진 노출) | 비동기 섹션 스트리밍 |
| `PlanFinalized` | C7 | C8(슬라이드 동기화 알림), Billing | |
| `PlanSectionChanged` | C7 | C8 | “슬라이드에 변경 반영” 알림 |
| `DeckGenerated` | C8 | Document Vault | |
| `PaymentCompleted` | C10 | C7·C8·C13(게이팅 해제), C11 | 다운로드 활성화 |
| `ConsultingRequested` | C9 | 어드민/CRM, C11 | 컨설턴트 배정 |
| `DeadlineApproaching` | C11(스케줄러) | User | D-7 / D-3 / D-1 |

## 2.5 상태머신 — Application 라이프사이클

`Application`(지원 건)은 컨설팅 회사의 내부 진행표를 **고객용 상태**로 옮긴 것이다.

```
DIAGNOSED ──선택공고지정──▶ PLAN_DRAFTING ──생성완료──▶ PLAN_REVIEW ──확정──▶ PLAN_DONE
                                                                          │
                            ┌─────────────────────────────────────────────┘
                            ▼
                       DECK_DRAFTING ──생성완료──▶ DECK_DONE ──(선택)──▶ CONSULTING_REQUESTED
                            │                                                    │
                            └───────────────▶ SUBMITTED ◀───────────────────────┘
                                                  │
                                     ┌────────────┴────────────┐
                                     ▼                         ▼
                                 SELECTED                   REJECTED
                                     │                         │
                                     └──────▶ AFTERCARE ◀──────┘
```

**전이 규칙(불변식)**
- `PLAN_DRAFTING → PLAN_REVIEW` 는 모든 섹션이 1회 이상 생성된 뒤에만.
- 다운로드가 필요한 전이(`PLAN_DONE`, `DECK_DONE`)는 **`PaymentCompleted` 또는 무료 게이팅 정책 충족** 시에만(C10).
- `ProfileUpdated` 수신 시 하위 산출물은 **stale 플래그**가 붙고 재생성 가능 상태로 표시(데이터 훼손 없이 이력 보존).
- 모든 전이는 도메인 이벤트를 1건 이상 발행한다(감사로그 ← C13).

## 2.6 횡단 도메인 정책 (Domain Policy)

1. **재사용 우선:** 한 번 입력한 데이터(Profile/Item)는 STEP2~6 전반에서 자동 채움. **재입력 요구는 결함**으로 간주.
2. **설명 가능성:** `matchScore`·AI 생성문은 **근거(evidence/trace) 없이 단독 노출 금지**. 매칭은 “사용자 입력 ○○ ↔ 공고 자격 ○○ 대조” 근거 칩을 동반.
3. **휴먼 인 더 루프:** AI 산출물은 항상 ‘초안’. 전문가 검수/사용자 편집 경로를 닫지 않는다.
4. **데이터 격리:** 고객 간 Row-level 격리는 보안이 아니라 **도메인 불변식**(영업비밀).
5. **Freemium 게이팅:** ‘미리보기 무료 / 전체 생성·다운로드 유료’가 기본. 게이팅 해제는 Billing 이벤트로만.

---

# 3. 정보구조(IA) · 사이트맵 · 퍼널 플로우

## 3.1 GNB (상단 메뉴)

| 1차 메뉴 | 2차 메뉴 | 매핑 |
|---|---|---|
| 서비스 소개 | — | 1차 랜딩 콘텐츠 유지(마케팅 채널) |
| AI 창업진단 | 내 정보 입력 / 아이템 진단 / 액셀러레이터 분석 | STEP 1~3 |
| 지원사업 매칭 | 맞춤 매칭 결과 / 전체 공고 보기 | STEP 4 |
| AI 사업계획서 | 사업계획서 작성 / 발표 슬라이드 작성 | STEP 5~6 |
| 전문가 컨설팅 | 1:1 컨설팅 신청 / 평가위원 출신 컨설턴트 소개 | STEP 7(기존 상담폼 고도화) |
| 마이페이지 | 내 프로필 / 결제내역 / 작성 문서 보관함 | 회원 전용 |

## 3.2 7-Step 퍼널 (단일 프로필 누적형)

```
[가입/로그인] → [세그먼트 택1~복수]
  └ STEP1 정보입력(최초 1회) ─ProfileCompleted
     └ STEP2 아이템 정의 → AI 아이템명 3안 → 선택 ─ItemNameSelected
        └ STEP3 액셀러레이터 분석(강점/약점/보완) ─AnalysisGenerated
           └ STEP4 매칭(매칭률 순, 필터) → [공고 1개 선택]
              └ STEP5 사업계획서 자동초안 → 편집 → 다운로드(docx/pdf)
                 └ STEP6 발표슬라이드 자동생성 → 편집 → 다운로드(pptx)
                    └ STEP7 [선택] 전문가 컨설팅(유료, 결제연동)
```

- **누적 원칙:** STEP1 입력값을 STEP5에서 **다시 입력하지 않는다**(도메인 정책 1).
- **게이팅:** 각 STEP은 ‘미리보기 무료 / 전체·다운로드 유료’ Freemium(9장).
- **모듈성:** 각 STEP은 독립 구매 가능하면서 앞 단계 데이터를 자동 상속.

## 3.3 공개 영역 vs 워크스페이스

| 영역 | 인증 | 내용 |
|---|---|---|
| 공개 랜딩 | 불필요 | 1차 마케팅 페이지 + **‘정부지원사업 진단’ 메인 CTA** |
| 워크스페이스(대시보드) | 로그인 | 내 프로필·아이템·분석·추천공고·사업계획서·발표자료·컨설팅·보관함·알림 |

---

# 4. 데이터 아키텍처 (4-Layer) & Canonical Schema

## 4.1 4계층 데이터 레이어

> 서비스 간 **데이터 재사용**을 가능케 하는 4층 분리(GPT판 아키텍처 채택).

| 레이어 | 소유 컨텍스트 | 저장 내용 |
|---|---|---|
| **L1 고객 데이터** | C2 Profiling | 회사·아이템·기술/IP·자금이력·지원경험·산출물 메타 |
| **L2 공고 데이터** | C5 Program Catalog | 정규화된 공고 원문·자격·기간·채널·평가항목·요구서류·태그 |
| **L3 내부 지식** | C12 Knowledge | 학습 MD/스킬·합격패턴·문장 템플릿·작성 노하우(RAG 코퍼스) |
| **L4 결과물** | C7/C8/C13 | 아이템명·분석·매칭결과·사업계획서 버전·슬라이드 버전·전문가 피드백 |

## 4.2 관계형 스키마 (핵심 테이블)

> 표기: `PK` 기본키, `FK` 외래키. PostgreSQL(`pg`) 기준. 기존 `schema.sql`의 `submissions`·`admins`는 STEP7/어드민으로 계승.

**L1 — 프로필 도메인**
```
customer_profile (PK user_id, biz_name, founded_year, industry_code, region,
                  employee_cnt, revenue_band, segments TEXT[], created_at, updated_at)
profile_business (FK profile_id, biz_summary, biz_summary_cache, product_desc,
                  core_tech, competitive_edge)              -- 1:1
profile_patent  (PK id, FK profile_id, type, name, number, issued_date)        -- 1:N
profile_funding_history (PK id, FK profile_id, program_name, year, amount, status) -- 1:N
profile_funding_current (PK id, FK profile_id, institution, amount, loan_type)    -- 1:N
```

**아이템 도메인 (STEP2)**
```
item_overview        (FK profile_id, usage_spec_price, core_function, customer_benefit)
item_problem         (FK profile_id, market_status, problem_point, necessity)
item_feasibility     (FK profile_id, dev_plan, output_form, output_qty, milestones JSONB)
item_differentiation (FK profile_id, strategy_1, strategy_2, strategy_3)   -- 정확히 3
item_name_suggestion (PK id, FK profile_id, suggestion_text, type, selected BOOL)
```

**분석 도메인 (STEP3)**
```
accelerator_analysis (PK id, FK profile_id, problem_fit_score, market_score,
                      founder_fit_score, differentiation_score, scalability_score,
                      version, created_at)
accelerator_comment  (PK id, FK analysis_id, area, comment_text, type)  -- 강점/보완
```

**L2 — 공고 카탈로그 (외부 연동 캐시)**
```
gov_program (PK program_id, source_portal, name, agency, operator_agency,
             field, amount, eligibility JSONB, period_start, period_end,
             funding_type, required_docs JSONB, evaluation_items JSONB,
             submission_channel, source_url, source_text, normalized_tags TEXT[],
             synced_at)
```

**L2/L4 경계 — 매칭**
```
match_result (PK id, FK profile_id, FK program_id, hard_filter_pass BOOL,
              score INT, score_breakdown JSONB, evidence JSONB, created_at)
```

**작업 애그리거트 + L4 — 사업계획서/슬라이드**
```
application      (PK id, FK user_id, FK program_id, status, created_at, updated_at) -- (user,program) UNIQUE
business_plan    (PK id, FK application_id, status, created_at, updated_at)
business_plan_section (PK id, FK plan_id, section_key, section_title, content,
                       char_limit, ai_generated BOOL, version)
plan_template    (PK id, program_type, section_structure JSONB, skill_ref_id)
plan_knowledge_doc (PK id, title, category, file_path_or_skill_id,
                    applicable_program_types TEXT[])           -- L3 메타
pitch_deck       (PK id, FK plan_id, theme, status, created_at)
pitch_deck_slide (PK id, FK deck_id, order_no, slide_type, headline,
                  body_content, visual_suggestion)
```

**횡단 — 과금/컨설팅/알림/감사**
```
orders, order_line, subscription, entitlement          -- C10 Billing
consulting_request (FK user_id, FK application_id, area, status, consultant_id) -- C9
notification (FK user_id, type, payload JSONB, sent_at, read_at)               -- C11
audit_log (FK user_id, action, target, meta JSONB, at)                        -- C13
segment_master (code PK, label, definition, active)        -- 세그먼트 코드성 관리
industry_code_map (gov_code PK, internal_code, label)      -- 매칭 코드체계 통일
```

## 4.3 Canonical Program Schema (ACL 출력 계약)

외부 크롤링 시스템의 **이질적 포맷을 단일 표준으로 번역**한다(C5의 ACL). 매칭·생성 로직은 이 표준에만 의존한다.

| 필드 | 타입 | 설명 |
|---|---|---|
| `program_id` | string | 전역 유일 ID(포털 prefix 권장) |
| `source_portal` | enum | `KSTARTUP` `BIZINFO` `SMES24` `IRIS` `SBIZ24` `WBIZ` … |
| `program_name` | string | 공고명 |
| `admin_agency` / `operator_agency` | string | 주관/운영 기관 |
| `target_stage` | enum[] | 예비/1년미만/1~3년/3~7년/소상공인/R&D준비 |
| `target_type` | enum[] | 세그먼트 대응 태그 |
| `eligibility_rules` | object[] | **정형 자격규칙**(업종/지역/연차/연령/규모/중복수혜) — 하드필터 입력 |
| `application_period` | {start,end} | 접수기간 |
| `funding_type` | enum | 사업화/R&D/융자/보증/교육/시설 등 |
| `max_amount` | number | 지원 한도 |
| `required_docs` | string[] | 요구 제출서류 |
| `evaluation_items` | object[] | 평가항목 + 배점(STEP5 목차·배점 입력) |
| `submission_channel` | string | 접수 채널/URL |
| `detail_url` | string | 공고 원문 링크 |
| `source_text` | text | 원문(요약·근거추출 원본) |
| `normalized_tags` | string[] | 정규화 태그 |

> **데이터 소스 4갈래 정규화:** 창업형(K-Startup·창업진흥원) / 중기일반(기업마당·중소벤처24) / 소상공인형(소상공인24) / R&D형(IRIS) + 여성기업포털 → **하나의 canonical schema로 합류**. 프런트는 표준 스키마만 소비한다.

> **리스크:** 외부 `eligibility`가 **자유텍스트(비정형)** 로만 제공되면 매칭 정확도가 급락. → 공고 1건당 자격규칙 태깅(정형화)을 **별도 공수**로 분리 산정(8장·11장).

---

# 5. SDD — 기능 명세 (Spec-Driven)

> 형식: `User Story(US) → 명세 → API 계약 → 수용 기준(AC)`. **AC = 완료의 정의(DoD)**. 모든 AC는 6장에서 동일 번호 테스트(`TC`)로 환원된다. AC는 **Given/When/Then** 으로 검증 가능하게 기술한다.

## 5.1 STEP 1 — 고객 정보 입력 / 프로필 빌더 (C2 Profiling)

**US-1** — *모든 세그먼트로서, 한 번만 입력하면 이후 모든 단계가 재사용하는 ‘고객 마스터 프로필’을 만들고 싶다. 매번 다시 설명하지 않기 위해.*

**명세 — 3-Tab 위저드**

| Tab | 필드(필수✱) | 비고 |
|---|---|---|
| 1 기본정보 | 사업장명✱, 설립연도✱(‘설립 전’ 분기), 업종/업태✱(표준산업분류 검색), 본사위치✱(시도-시군구), 직원수✱, 연매출, **세그먼트(9종 다중)✱** | 세그먼트=매칭 1차 필터 |
| 2 사업정보 | 사업개요✱(≤1000자, AI 다듬기), 제품/서비스✱(+이미지), 핵심기술(R&D는 필수전환), 특허·인증(동적), 경쟁우위✱(≤500자) | 장문은 요약 캐싱 |
| 3 자금/지원경험 | 과거 수행경험✱(Y/N+리스트), 보유 정책자금/대출, 희망 조달규모, R&D 과제경험 | 중복수혜 검증·정책자금 매칭 |

**API 계약**

| Method | Path | 설명 |
|---|---|---|
| `POST` | `/api/profile` | 프로필 생성(부분 저장 허용, 위저드 탭별 PATCH 가능) |
| `GET` | `/api/profile` | 내 프로필 조회(자동 채움 소스) |
| `PATCH` | `/api/profile` | 수정 → `ProfileUpdated` 이벤트 |
| `POST` | `/api/profile/ai-polish` | 사업개요 ‘AI 다듬기’ |

**수용 기준(AC)**
- **AC-1.1** Given 세그먼트 미선택, When 저장, Then 거부(세그먼트 ≥1 불변식) + 필드 오류 표시.
- **AC-1.2** Given 모든 필수 입력, When 저장, Then `customer_profile` 1행 + `ProfileCompleted` 발행.
- **AC-1.3** Given 업종 선택, Then 저장 코드가 `industry_code_map`의 매칭 API 코드체계와 **동일 코드값**.
- **AC-1.4** Given 세그먼트에 `RND` 포함, When Tab2 진행, Then 핵심기술 필드가 **필수로 전환**.
- **AC-1.5** Given 완성된 프로필, When STEP2~6 진입, Then 프로필 값이 **자동 채움**(재입력 요구 0회).
- **AC-1.6** Given 프로필 수정, When 하위 산출물 존재, Then 하위는 **stale 표시 + 재계산 알림**(데이터 보존).
- **AC-1.7** Given 다른 사용자, When 내 프로필 조회 시도, Then Row-level 격리로 **접근 불가**.

## 5.2 STEP 2 — 아이템 정의 + AI 사업아이템명 (C3 Item Definition)

**US-2** — *예비/기창업자로서, 아이템개요·문제인식·실현가능성·차별화전략을 입력하면 심사위원이 한눈에 이해하는 ‘합격형 아이템명’ 3안을 받고 싶다.*

**명세 — 4단계 입력 + 생성**

| 입력 | 내용 | UI 보조 |
|---|---|---|
| ① 아이템 개요 | 용도/사양/가격, 핵심기능, 고객혜택 | 예시 가이드 박스 고정 |
| ② 문제인식 | 시장현황·문제점, 필요성 | ‘근거자료 추천’ 버튼(AI) |
| ③ 실현가능성 | 개발계획, 산출물 형태/수량 | 마일스톤 타임라인 UI |
| ④ 차별성/경쟁력 | **정확히 3가지** | 3슬롯 카드 고정(4번째 추가 불가) |

**AI 아이템명 생성 로직** — ①~④ + STEP1(사업개요·경쟁우위)을 결합, **3안** 제안:
1. 합격작 공통 패턴(핵심기술+적용대상+효과)
2. 심사위원이 한 줄로 본질 파악하는 ‘문제해결형’
3. 영어 약어·유행어 지양, 공공문서체 어휘
출력: `[기술중심]`/`[혜택중심]`/`[문제중심]` 3카드(각 ≤30자) → 1개 선택/직접수정 → STEP3 활성화.

**API 계약**

| Method | Path | 설명 |
|---|---|---|
| `POST` | `/api/items` | 아이템 ①~④ 저장 |
| `POST` | `/api/items/name-suggestions` | 3안 생성(LLM) |
| `PATCH` | `/api/items/name-suggestions/:id/select` | 1안 선택 → `ItemNameSelected` |

**수용 기준(AC)**
- **AC-2.1** Given 차별화전략 < 3개, When 다음 단계, Then **진행 버튼 비활성**(정확히 3개 불변식).
- **AC-2.2** Given 4번째 전략 추가 시도, Then UI가 **차단**(슬롯 3개 고정).
- **AC-2.3** Given ①~④ + STEP1 데이터, When 생성, Then **3안** 반환(각 유형 태그 포함, ≤30자).
- **AC-2.4** Given 3안 표시, When 1안 선택, Then `selected=true`가 **정확히 1건** + `ItemNameSelected` 발행.
- **AC-2.5** Given STEP2 입력값, When STEP5 진입, Then ‘아이템개요/문제인식/실현가능성’ 섹션에 **자동 연동**(재입력 0).

## 5.3 STEP 3 — 전문 액셀러레이터 분석 (C4 Diagnosis)

**US-3** — *창업자로서, 정부지원사업 심사 관점의 강점·약점 진단 리포트를 받아 약점을 보완하고 싶다.*

**명세 — 5영역 진단 리포트**

| 영역 | 기준 | 출력 |
|---|---|---|
| 문제-해결 적합성 | 문제 정의 명확성, 솔루션 연결성 | 5점 게이지 + 코멘트 |
| 시장 크기·성장성 | TAM/SAM/SOM 타당성, 트렌드 | 5점 게이지 + 코멘트 |
| 실행역량(Founder-Market Fit) | 대표 경력·기술 적합성 | 5점 게이지 + 코멘트 |
| 차별성/진입장벽 | STEP2 전략 3가지 방어가능성 | 5점 게이지 + 코멘트 |
| 확장가능성(Scalability) | 반복·확장 여지 | 5점 게이지 + 코멘트 |
| 종합 강점 Top3 / 보완 Top3 | 상·하위 자동 추출 | 리스트 + **보완 실행 가이드** |

- 결과 화면: 레이더 차트 → 영역별 코멘트 → 강점/보완 → ‘STEP4 매칭 보기’.
- 각 보완점에 **‘사업계획서 작성 시 이 항목 보강’** 후속 액션 버튼(분석을 작성AI의 전처리로 연결).

**⚠ 명칭 규칙(2.1):** 내부만 `GStack` 참조, **대외 출력에 YC/GStack 토큰 0회**(후처리 필터 필수).

**API 계약**: `POST /api/analysis`(생성, → `AnalysisGenerated`), `GET /api/analysis/:id`, `GET /api/analysis/history`(버전 비교).

**수용 기준(AC)**
- **AC-3.1** Given STEP1·2 완료, When 분석 생성, Then 5영역 점수 **모두 존재**(각 0~5) + 강점/보완 Top3.
- **AC-3.2** Given 생성된 리포트/문서/카피, Then 출력 텍스트에 `YC`·`GStack`·`Y Combinator` **토큰 0건**(필터 검증).
- **AC-3.3** Given STEP2 수정 후 재분석, Then 신규 버전 생성 + **이전 버전 보존**(이력 비교 가능).
- **AC-3.4** Given 보완점 카드, When ‘보강’ 클릭, Then 해당 항목이 STEP5 생성 컨텍스트에 **플래그로 전달**.

## 5.4 STEP 4 — 정부지원사업 매칭 (C6 Matching · C5 연동)

**US-4** — *창업자로서, 내 정보 기준으로 전체 공고의 매칭률과 ‘왜 매칭되는지’를 보고 지원할 공고를 고르고 싶다.*

**명세 — 2단계 매칭**

1) **하드필터(Hard Filter)** — 미달 시 0% 또는 리스트 제외: 업종코드, 지역(전국 vs 지자체), 사업연차, 연령(청년≤39/중장년≥40), 매출·직원수, **중복수혜 제한**(STEP1 자금경험).
2) **소프트 스코어(0~100)** — 필터 통과분 가중 합산:

| 요소 | 가중치(예시) | 근거 데이터 |
|---|---|---|
| 업종/기술 적합도 | 30% | 업종·핵심기술 vs 공고 분야(임베딩 유사도) |
| 세그먼트 적합도 | 20% | 9종 세그먼트 vs 공고 대상조건 |
| 사업단계 적합도 | 20% | 설립연차 vs 요구 성장단계 |
| 자금규모 적합도 | 15% | 희망 조달 vs 공고 한도 |
| 가점 요소 | 15% | 특허·인증·R&D 경험 |

- **화면:** 매칭률 내림차순 카드(공고명/기관/금액/매칭률 배지/D-day), 필터(세그먼트·분야·정렬 토글), 공고 상세 모달(AI 3줄 요약, **자격 체크리스트 충족/미충족**, ‘이 공고로 사업계획서 작성’ CTA → STEP5).
- **설명 가능성(정책 2):** 각 매칭은 **근거 칩(evidence chip)** — “내 입력 ○○ ↔ 공고 자격 ○○ 대조” 를 동반. 6블록 근거(자격/주제/단계/지역·연령/가점/주의사항).
- **성능:** 공고×고객 매칭은 **야간 사전배치 + 캐싱**, 신규 공고 등록(`ProgramSynced`) 시에만 증분 재계산(11장).

**API 계약**

| Method | Path | 설명 |
|---|---|---|
| `GET` | `/api/match?segment=&field=&sort=` | 내 매칭 리스트(캐시 우선) |
| `GET` | `/api/match/:programId/evidence` | 근거 칩 상세 |
| `GET` | `/api/programs/:id` | 공고 상세(요약·자격 체크리스트) |
| `POST` | `/api/match/recalculate` | 강제 재계산(프로필 변경 후) |

**수용 기준(AC)**
- **AC-4.1** Given 하드필터 미달 공고, Then 결과에서 **제외 또는 0%**(노출 시 사유 명시).
- **AC-4.2** Given 중복수혜 이력과 동일/유사 사업, Then 해당 공고 **하드필터 탈락**.
- **AC-4.3** Given 필터 통과 공고, Then score∈[0,100] + `score_breakdown` 5요소 합이 화면 가중치와 **일치**.
- **AC-4.4** Given 매칭 결과, When 근거 펼치기, Then **‘내 입력 ↔ 공고 자격’ 대조 근거** 표시(숫자만 단독 노출 금지, 정책 2).
- **AC-4.5** Given 마감된 공고, Then D-day가 음수면 ‘마감’ 처리(‘마감 공고 추천’ 방지).
- **AC-4.6** Given 신규 공고 동기화, Then 영향 받는 프로필만 **증분 재계산**(전체 재계산 아님).

## 5.5 STEP 5 — 사업계획서 작성 AI (C7 Plan Authoring · 매출 핵)

**US-5** — *지원자로서, 선택한 공고에 맞춰 내 데이터·학습자료를 결합한 사업계획서 초안을 섹션별로 받아 편집·다운로드하고 싶다.*

**명세 — 입력 3종 → 5단계 파이프라인 → 에디터**

입력 3종: ① 공고문(PDF/HTML 파싱 → 평가항목·배점·양식 추출) ② 고객 데이터(STEP1~3 자동 조회) ③ 학습자료(RAG: `plan_knowledge_doc`/스킬).

생성 파이프라인(7장 상세):
```
(1) 공고 파서 → 평가항목·배점·필수서류·분량 추출
(2) 프로파일 정렬기 → 공고에 필요한 고객 사실만 선별
(3) 지식 검색기(RAG) → program_type별 합격 템플릿·전략 검색
(4) 섹션 생성기 → 섹션 단위 초안(섹션마다 개별 LLM 호출)
(5) 검증기 → 공고 키워드 누락·수치 근거·과장·자체 중복도 점검
```

에디터(좌우 분할): 좌=평가항목 목차 트리, 우=섹션 텍스트(인라인 편집, 글자수/권장 카운터). 섹션 상단 `[AI 재생성][근거 추가][톤 변경][되돌리기]`. 하단 `[임시저장][미리보기 PDF][다운로드(결제 후)]`.
편집 모드: 초안 → 문장 강화 → 정량 근거 추가 → 평가위원 관점 보강 → 분량 축약 → 전문가 검수 요청.

**출처 트레이스(정책 2):** 각 문단은 “고객 입력 ○○ + 공고 평가항목 ○○ + 내부 스킬 ○○ 반영” 근거 span을 보유.

**API 계약**

| Method | Path | 설명 |
|---|---|---|
| `POST` | `/api/applications` | (user,program) 지원건 생성 |
| `POST` | `/api/plans/:id/parse-program` | 공고문 파싱(목차·배점) |
| `POST` | `/api/plans/:id/sections/generate` | 전체 섹션 비동기 생성(스트리밍) |
| `POST` | `/api/plans/:id/sections/:key/regenerate` | **단일 섹션** 재생성 |
| `GET` | `/api/plans/:id/export?format=docx\|pdf` | 다운로드(결제 게이팅) |

**수용 기준(AC)**
- **AC-5.1** Given 공고 선택, When 파싱, Then 평가항목·배점 구조를 추출해 목차 트리로 표시.
- **AC-5.2** Given 생성 요청, Then 섹션은 **개별 호출로 분리 생성**(점진 노출, `PlanSectionGenerated` 스트리밍).
- **AC-5.3** Given 특정 섹션 재생성, Then **다른 섹션 내용 불변**(섹션 독립성 불변식).
- **AC-5.4** Given 동일 고객, When 다른 공고 선택, Then `business_plan`이 **공고 단위로 N개** 생성(1:N).
- **AC-5.5** Given 생성 문단, Then **출처 트레이스(고객/공고/스킬)** 가 함께 저장·표시.
- **AC-5.6** Given 생성 결과, Then 자체 학습자료와의 **중복도 임계 초과 시 경고**(표절 방지).
- **AC-5.7** Given 미결제, When 다운로드, Then **차단**(미리보기는 허용); 결제 완료(`PaymentCompleted`) 시 활성화.

## 5.6 STEP 6 — 발표(IR) 슬라이드 AI (C8 Pitch Deck)

**US-6** — *지원자로서, 확정된 사업계획서를 5~10분 발표용 슬라이드로 자동 변환받고 싶다.*

**명세** — STEP5 섹션 자동 로드 → 표준 발표 구조로 **압축·시각화** → 슬라이드별 `핵심 메시지 1줄 + 보조 설명 + 시각화 제안(표/그래프/이미지 placeholder)`. 슬라이드 단위 순서변경/재생성/테마선택. pptx 다운로드(결제 후).

표준 9슬라이드(데이터 소스): 표지(STEP2명+STEP1) / 문제인식(STEP2②) / 솔루션(STEP2①) / 차별성(STEP2④) / 실현가능성(STEP2③) / 시장·확장(STEP3) / 팀·대표(STEP1) / 자금운용(STEP4 한도+추가입력) / 클로징(AI). 테마 최소 3종(기본/모던/공공기관형).

**API 계약**: `POST /api/decks`(plan→deck 생성), `PATCH /api/decks/:id/slides/:order`(순서/재생성), `GET /api/decks/:id/export?format=pptx`(게이팅).

**수용 기준(AC)**
- **AC-6.1** Given 확정 사업계획서, When 슬라이드 생성, Then 표준 구조 슬라이드가 각 STEP 데이터 소스에 **매핑**되어 생성.
- **AC-6.2** Given 사업계획서 섹션 변경(`PlanSectionChanged`), Then 슬라이드에 **‘변경 반영’ 알림** 표시.
- **AC-6.3** Given 미결제, When pptx 다운로드, Then 차단; 결제 시 활성화.
- **AC-6.4** Given 1 BusinessPlan, Then PitchDeck은 **1:1**(중복 생성 금지, 재생성은 버전).

## 5.7 STEP 7 — 전문가 1:1 컨설팅 (C9 Consulting · 휴먼 업셀)

**US-7** — *AI 결과를 더 다듬고 싶은 고객으로서, 내 전체 컨텍스트를 이미 아는 전문가의 첨삭·코칭을 유료로 받고 싶다.*

**명세** — 1차 사이트 상담폼 **계승 + 고도화**:

| 구분 | 1차 상담폼 | STEP7 |
|---|---|---|
| 신청 시점 | 즉시(정보 없음) | STEP1~6 축적 후(맥락 보유) |
| 컨설턴트 사전정보 | 폼 단편 | **전체 프로필+매칭+AI 사업계획서 열람** |
| 과금 | 무료(리드) | **유료**(건당/패키지) |
| 배정 | 랜덤/순번 | **전문분야·평가위원 경력 기준 매칭** |

- STEP6 완료 화면 하단 ‘전문가 첨삭 신청’ CTA **상시 노출**(만족도 무관, 업셀 보장).
- 폼: 기존 필드(이름/연락처/현재상태/업종/관심사업) **자동 채움** + ‘컨설팅 희망영역(사업계획서 첨삭/발표코칭/서류준비/세무·노무)’.
- 결제 → 컨설턴트 배정 → 캘린더 일정조율 → 진행. 기존 `submissions` 테이블 계승.

**수용 기준(AC)**
- **AC-7.1** Given STEP1~6 데이터, When 컨설팅 신청, Then 기존 폼 필드 **자동 채움** + 컨설턴트가 전체 컨텍스트 **열람 가능**.
- **AC-7.2** Given 결제 완료, Then `ConsultingRequested` 발행 + 전문분야 기준 컨설턴트 배정 후보 산출.
- **AC-7.3** Given STEP6 완료 화면, Then 만족도와 무관하게 ‘전문가 첨삭’ CTA가 **항상 노출**.

## 5.8 공통 — 마이페이지 · 알림 (C11 Notification · C13 Vault)

**US-8** — *회원으로서, 내 작업·결제·문서를 한 곳에서 누적 관리하고 마감을 놓치지 않고 싶다.*

**마이페이지**: 내 프로필(수정 시 하위 재계산 알림) / 내 아이템(STEP2~3 이력) / 매칭 현황(즐겨찾기·마감알림) / **문서 보관함**(버전별 다운로드 이력) / 결제·구독(세금계산서) / 컨설팅 내역.

**알림(Notification)**: 신규 매칭 공고(세그먼트·업종 기준 push/email) / 관심공고 마감 **D-7·D-3·D-1** / 사업계획서 생성 완료·대기.

**수용 기준(AC)**
- **AC-8.1** Given 관심공고, Then 마감 D-7/D-3/D-1 시점에 `DeadlineApproaching` → 알림 발송(중복 없이 각 1회).
- **AC-8.2** Given 다운로드, Then `audit_log`에 사용자·대상·시각 **감사로그 적재**.
- **AC-8.3** Given 문서 보관함, Then 사업계획서·슬라이드가 **버전별**로 조회·재다운로드 가능.

---

# 6. TDD — 테스트 전략 (Test-Driven)

> 원칙: **AC를 먼저 실패하는 테스트(`TC`)로 작성**하고, 그 테스트를 통과시키는 방향으로 구현한다. 각 `AC-x.y` 는 `TC-x.y` 와 1:1 대응한다(6.5 매트릭스). 테스트가 녹색이 되어야 해당 AC가 “충족”으로 인정된다.

## 6.1 테스트 피라미드

| 층 | 비중 | 대상 | 도구(제안) |
|---|---|---|---|
| **단위(Unit)** | 70% | 도메인 불변식·매칭 스코어·상태전이·게이팅 규칙 | Jest |
| **통합(Integration)** | 20% | API 계약·DB·외부 연동(ACL)·이벤트 | Supertest + 테스트 DB(pg) |
| **E2E** | 10% | 7-Step 퍼널 사용자 여정·결제 게이팅·다운로드 | Playwright |
| **AI 계약(횡단)** | — | 생성물의 스키마·금지토큰·근거 존재(속성 기반) | 6.3 전략 |

## 6.2 도메인 규칙 단위 테스트 (핵심 불변식)

> AI 호출 없이 **순수 함수**로 검증 가능한 도메인 규칙은 단위 테스트로 못 박는다. 비결정성에서 분리하는 것이 핵심.

- `differentiationStrategies.length === 3` 강제 (AC-2.1/2.2)
- `SegmentSet.size >= 1` (AC-1.1)
- `RND ∈ segments ⇒ coreTech.required` (AC-1.4)
- 하드필터: `eligibility.fail ⇒ excluded || score===0` (AC-4.1/4.2)
- 스코어 합산: `Σ(weightᵢ × subScoreᵢ) === score`, `score ∈ [0,100]` (AC-4.3)
- 상태전이: 허용 표에 없는 전이는 예외 (2.5, AC-5.x 전제)
- 게이팅: `download() ⇒ requires entitlement` (AC-5.7/6.3)
- 섹션 독립성: `regenerate(sₖ)` 후 `∀ j≠k: sⱼ unchanged` (AC-5.3)

```js
// 예시 — TC-2.1 / TC-2.2 (Jest)
describe('Item 차별화 전략 불변식', () => {
  test('TC-2.1 3개 미만이면 진행 차단', () => {
    const item = makeItem({ strategies: ['a', 'b'] });
    expect(() => item.proceed()).toThrow('정확히 3개');
    expect(item.canProceed()).toBe(false);
  });
  test('TC-2.2 4번째 추가 거부', () => {
    const item = makeItem({ strategies: ['a','b','c'] });
    expect(() => item.addStrategy('d')).toThrow();
  });
});

// 예시 — TC-4.3 매칭 스코어 합산 (속성 기반)
test('TC-4.3 score breakdown 합 = score, 0~100', () => {
  fc.assert(fc.property(arbProfile(), arbProgram(), (p, g) => {
    const r = match(p, g);
    if (!r.hardFilterPass) return r.score === 0;
    const sum = sumWeighted(r.scoreBreakdown);
    return r.score === sum && r.score >= 0 && r.score <= 100;
  }));
});
```

## 6.3 AI 출력 검증 전략 (비결정성 다루기)

LLM 출력은 값이 매번 달라 **정확 일치(assert equals)로 검증 불가**. 대신 **계약·속성·골든셋**으로 검증한다.

| 검증 종류 | 방법 | 적용 AC |
|---|---|---|
| **스키마 계약** | 출력 JSON이 스키마 충족(3안·유형태그·≤30자) | AC-2.3 |
| **금지 토큰 필터** | 출력에 `YC/GStack/Y Combinator` 정규식 매치 0건 | **AC-3.2** |
| **구조 불변식** | 5영역 점수 모두 존재·범위 | AC-3.1 |
| **근거 존재성** | 생성 문단마다 trace(고객/공고/스킬) 비어있지 않음 | AC-5.5 |
| **중복도 임계** | 자체 코퍼스 대비 유사도 < 임계 | AC-5.6 |
| **골든셋 회귀** | 고정 입력셋에 대해 LLM-as-judge 루브릭 점수 ≥ 기준 | 생성 품질 |
| **결정성 격리** | `temperature=0` + 시드 고정으로 CI 재현성 확보(가능 범위) | 횡단 |

```js
// 예시 — TC-3.2 명칭 금지 필터(가장 중요한 규정 테스트)
test('TC-3.2 대외 출력에 내부 코드네임 절대 미노출', async () => {
  const out = await generateAnalysis(sampleProfile);     // 리포트+코멘트 전체
  const banned = /YC|GStack|Y\s?Combinator/i;
  expect(banned.test(JSON.stringify(out))).toBe(false);  // 후처리 필터 통과 보장
});
```

## 6.4 수용 테스트 시나리오 (E2E — 퍼널 골든 패스)

```
시나리오 E2E-1: 신규 사용자 풀퍼널 (해피패스)
 Given 신규 가입 + 세그먼트 [YOUTH, EARLY] 선택
 When  STEP1 프로필 완성 → STEP2 아이템+차별화 3개 → 아이템명 1안 선택
       → STEP3 분석 생성 → STEP4 매칭 1위 공고 선택
       → STEP5 섹션 생성 → 결제 → docx 다운로드 → STEP6 pptx → STEP7 신청
 Then  ① 어느 단계도 STEP1 정보 재입력을 요구하지 않는다 (AC-1.5/2.5)
       ② STEP4 결과에 근거 칩이 보인다 (AC-4.4)
       ③ 결제 전 다운로드는 차단, 결제 후 활성화된다 (AC-5.7/6.3)
       ④ Application 상태가 DIAGNOSED→…→DECK_DONE→CONSULTING_REQUESTED로 전이 (2.5)

시나리오 E2E-2: 프로필 수정 → 하위 재계산
 Given STEP3까지 완료한 사용자
 When  STEP1 업종을 변경
 Then  STEP3 분석·STEP4 매칭이 stale 표시 + 재계산 알림, 기존 이력은 보존 (AC-1.6/3.3)

시나리오 E2E-3: 자격 미달 / 중복수혜
 Given 과거 동일사업 수혜 이력 보유 + 연령 40세
 When  청년(≤39) 전용 + 중복수혜 제한 공고를 조회
 Then  해당 공고는 하드필터 탈락(제외 또는 0%) (AC-4.1/4.2)
```

## 6.5 추적성 매트릭스 (US → AC → TC)

| User Story | 수용 기준(AC) | 테스트(TC) | 층 |
|---|---|---|---|
| US-1 프로필 | AC-1.1~1.7 | TC-1.1~1.7 | Unit/Integration/E2E-2 |
| US-2 아이템명 | AC-2.1~2.5 | TC-2.1~2.5 | Unit + AI계약(2.3) |
| US-3 분석 | AC-3.1~3.4 | TC-3.1~3.4 | AI계약(3.2 필수) |
| US-4 매칭 | AC-4.1~4.6 | TC-4.1~4.6 | Unit(4.3) + E2E-3 |
| US-5 사업계획서 | AC-5.1~5.7 | TC-5.1~5.7 | Integration + E2E-1 |
| US-6 슬라이드 | AC-6.1~6.4 | TC-6.1~6.4 | Integration |
| US-7 컨설팅 | AC-7.1~7.3 | TC-7.1~7.3 | Integration |
| US-8 마이/알림 | AC-8.1~8.3 | TC-8.1~8.3 | Unit(스케줄)+Integration |

> **완료의 정의(DoD, 전 STEP 공통):** 해당 STEP의 모든 `TC`가 녹색 + 커버리지 기준 충족 + AI 계약 테스트(스키마·금지토큰·근거) 통과 + E2E 해피패스 1건 통과.

## 6.6 CI 게이트

1. PR마다 **Unit + Integration 필수 통과**(머지 차단 게이트).
2. AI 계약 테스트(6.3)는 `temperature=0` 고정으로 회귀 검출; 골든셋 점수 하락 시 경고.
3. E2E(Playmaker 퍼널)는 나이틀리 + 릴리즈 전 필수.
4. 접근성 검사(10장 KWCAG)·보안 정적분석을 게이트에 포함.

---

# 7. AI 파이프라인 아키텍처 (C12 Knowledge & AI Orchestration)

## 7.1 원칙 — 단일 범용 프롬프트 금지

하나의 거대 프롬프트로 모든 걸 처리하지 않는다. **작업 단위 모듈**로 분리하고, 모두 **동일 `application_id`/`profile_id` 컨텍스트** 아래에서 동작한다.

| 모듈 | 입력 | 출력 | 검증(TDD 연계) |
|---|---|---|---|
| 자격 판별기 | Profile + EligibilityRule | pass/fail + 사유 | AC-4.1/4.2 |
| 아이템명 생성기 | Item ①~④ + Profile | 3안(유형태그) | AC-2.3(스키마) |
| 액셀러레이터 분석기 | Profile + Item | 5영역 점수 + 코멘트 | AC-3.1, **AC-3.2(필터)** |
| 매칭 스코어러 | Profile vs Program(임베딩) | score + breakdown + evidence | AC-4.3/4.4 |
| 문서 생성기 | 공고구조 + Profile + RAG | 섹션 초안 + trace | AC-5.2/5.5 |
| 슬라이드 생성기 | 확정 Plan | 슬라이드 초안 | AC-6.1 |
| 검증기(Guard) | 생성물 | 누락·과장·중복·금지토큰 리포트 | AC-3.2/5.6 |

## 7.2 RAG & 근거 추적 (Plan Authoring 중심)

```
공고문 ──parse──▶ 평가항목/배점 구조
                      │
Profile(L1) ──정렬──▶ 섹션별 필요 사실
                      │
KnowledgeDoc(L3) ──RAG 검색(program_type 필터)──▶ 합격 템플릿/전략 chunk
                      │
        섹션별 개별 LLM 호출(섹션 독립) ──▶ 초안 + evidence span
                      │
              검증기(누락·수치·과장·중복·금지토큰) ──▶ 통과/경고
```

- **섹션 단위 생성**(통짜 금지): 재생성 시 타 섹션 불변(AC-5.3).
- **근거 span 필수**: 모든 문단에 (고객/공고/스킬) 출처 — 신뢰·편집효율·책임성(AC-5.5).
- **출력 후처리 필터**: 금지 토큰·과장 표현 차단(AC-3.2).
- **프라이버시**: AI 호출 데이터가 외부 모델 **학습에 재사용되지 않도록** API 약관 확인(10장).

## 7.3 비용·성능 운영

- 매칭은 임베딩 사전계산 + 야간 배치 캐싱(11장 성능).
- 사업계획서는 섹션 **비동기 스트리밍**으로 체감 대기 최소화(AC-5.2).
- 생성 결과·프롬프트는 버전·근거와 함께 L4에 보관(재현·감사).

---

# 8. 외부 연동

## 8.1 크롤링 시스템 ↔ 플랫폼 (C5 ACL)

> **신규 크롤러 개발 없음.** 기존 ‘정부지원사업 크롤링 DB/시스템’과 연동 인터페이스만 설계.

| 항목 | 요구 스펙 | 비고 |
|---|---|---|
| 연동 방식 | **REST API 권장** 또는 Read Replica 직접 조회 | API가 결합도 낮아 권장 |
| 제공 데이터 | 공고명·기관·분야·금액·**자격조건(정형)**·기간·원문URL/PDF | 자격조건 정형화 필수 |
| 갱신 주기 | 최소 **1일 1회 배치** 또는 실시간 webhook | 마감 알림과 연계 |
| 포맷 | JSON(canonical schema 권장) | 자유텍스트만 제공 시 NLP 정형화 단계 추가(공수↑) |

**ACL 책임:** 외부 포맷 → `gov_program`(4.3 canonical)으로 번역, 포털별 예외 흡수, `ProgramSynced` 발행. 외부 변경이 C6/C7로 새지 않게 격리.

## 8.2 결제(PG) · 캘린더

- **결제 PG**: 자체 개발 없이 외부 PG 연동. `PaymentCompleted` 이벤트로만 게이팅 해제(C10).
- **캘린더**: STEP7 컨설턴트 일정 조율(외부 캘린더 연동 옵션).
- **알림 채널**: email/push(C11). 마감 D-day 스케줄러.

---

# 9. 과금 / 가격 모델

## 9.1 구조 — 단계별 개별구매 + 컨설팅 업셀(투트랙)

STEP1~6은 개별/패키지 AI 서비스, STEP7은 별도 휴먼 컨설팅 업셀.

| STEP | 서비스 | 과금(제안) | 게이팅 |
|---|---|---|---|
| 1 | 프로필 입력 | **무료**(전환 진입) | — |
| 2 | 아이템 정의 + AI 아이템명 | 무료 또는 STEP3 묶음 저가 | 1안 미리보기 무료, 3안 상세 유료 |
| 3 | 액셀러레이터 분석 | 소액 단품(예: 1만원대) | 요약 무료, 상세 PDF 유료 |
| 4 | 매칭 | 무료 또는 3건까지 무료 | 리드 핵심 → 최대한 무료 |
| 5 | **사업계획서**(핵심 매출) | 공고 1건당 유료 | 섹션 미리보기 무료, **docx 다운로드 유료** |
| 6 | 발표 슬라이드 | 단품 또는 STEP5 번들 할인 | pptx 다운로드 유료 |
| 7 | 전문가 컨설팅 | 건당/시간당/합격보장형 | 평가위원 프리미엄 |

## 9.2 패키지

- **올인원**: STEP1~6을 공고 1건 기준 묶음 할인.
- **구독형**: 월 구독 = 매칭 알림 상시 + 사업계획서 월 1~2건 크레딧(반복 지원 고객).
- **성공보수 연계**: STEP7 한정 ‘선정 시 후불 수수료’ 옵션 검토(1차 ‘선정률 38→71%’ 마케팅과 연결).

## 9.3 유의점

- STEP1·4(입력·매칭)는 무료로 넓게 열어 리드 확보 → **STEP5에서 본격 과금**(깔때기).
- 동일 공고 **재생성 과금 정책**(섹션 재생성 무제한 vs 횟수 제한)을 사전 명확화. → 게이팅 단위 테스트로 고정(6.2).

---

# 10. 비기능 요구사항 (NFR) & 컴플라이언스

## 10.1 보안 · 개인정보 (도메인 불변식 수준)

- **데이터 격리**: 고객 간 Row-level 권한 — 사업개요·기술정보는 영업비밀(AC-1.7). 보안이자 도메인 불변식.
- **제3자 제공 금지**: 1차 사이트의 ‘상담 목적 외 제3자 제공 금지’ 원칙을 신규 기능에 동일 적용.
- **AI 재학습 차단**: 고객 데이터가 외부 모델 학습에 재사용되지 않도록 API 약관 확인.
- **기준선(성장 대비)**: DB·파일 저장소 암호화, 관리자 접근권한 분리, 프롬프트 로그 마스킹, 출력 버전 이력, 다운로드 감사로그(C13).
- **법·기준 참조**: 개인정보보호위원회 개인정보 처리방침 작성지침(2026.4) 및 생성형 AI 개인정보 처리 안내서(2025.8), KISA 안전성 확보조치 기준. 접속기록 **최소 1년**(민감·고유식별정보 또는 5만명 이상 시 **2년**) 보관.
- **처리방침 필수 항목**: 수집목적·보유기간·제3자 제공·처리위탁·파기·정보주체 권리·쿠키/자동수집·보호책임자·**생성형 AI 처리 고지**.
- **AI 고지(신뢰 장치)**: ‘AI 결과는 초안, 검토 필요’·입력 처리목적·재학습 여부·민감정보 주의·전문가 검수 옵션 명시.

## 10.2 웹 접근성

- 기준: **KWCAG 2.2**(2025~). 합격 기준선 — 전문가 심사 준수율 ≥95%, 사용자 심사 과업 성공률 100%.
- 타깃에 중장년·소상공인 포함 → 글자 대비, 폼 레이블, 키보드 탐색, 도움정보, 반복입력 정보, 접근 가능한 인증을 **초기 설계에 반영**. 마감 급한 사용자일수록 폼 접근성·오류 복구가 전환율에 직결.

## 10.3 성능 · 확장성

- **성능**: STEP5 섹션 비동기 처리(완료 즉시 순차 노출); STEP4 매칭은 야간 사전배치+캐싱, 신규 공고 등록 시 증분 재계산.
- **확장성**: 세그먼트는 마스터 테이블(코드성) — 사회적기업·소셜벤처 등 확장 대비; hwp 변환은 백로그 별도 모듈.

## 10.4 운영 — 4단 승인 워크플로

`AI 생성 → 전문가 검수 → 고객 확인 → 최종 산출물 잠금`. 정책자금·보증·R&D 등 고위험 건은 자동생성으로 끝내지 않고 검수에서 자격요건·수치·일정·증빙 일치를 재확인.

---

# 11. 개발 로드맵 (Phase + Phase별 수용 기준)

| Phase | 범위 | 핵심 목표 | Phase 완료 기준(샘플) |
|---|---|---|---|
| **P1 기반** | 가입/로그인, STEP1 프로필, 마이페이지 골격, 1차 콘텐츠 마이그레이션 | AI 없이도 동작하는 데이터 기반 | AC-1.x 전부 녹색, E2E 로그인~프로필 |
| **P2 매칭 연동** | 크롤링 API 연동(ACL), STEP4 하드필터, 매칭 결과 화면 | **데이터→공고 매칭 핵심가치 MVP** | AC-4.1/4.2/4.5, E2E-3 |
| **P3 AI 진단/생성 1차** | STEP2 아이템+아이템명, STEP3 분석, STEP4 스코어링 고도화 | 생성형 기능 최초 도입 | AC-2.x/3.x/4.3/4.4 + AI계약(3.2) |
| **P4 사업계획서 자동화** | STEP5(RAG 파이프라인), 결제모듈 | **핵심 매출 기능 출시** | AC-5.x, 게이팅 TC, E2E-1 결제 |
| **P5 슬라이드+컨설팅** | STEP6, STEP7 고도화, 패키지/구독 | 풀퍼널 완성 + 업셀 | AC-6.x/7.x, 과금 TC |
| **P6 고도화** | 매칭 가중치 피드백 루프(합격데이터), 세그먼트 확장, hwp | 운영데이터 기반 정교화 | 가중치 보정 회귀, 확장 마스터 |

> 우선순위 기준: **‘어떤 STEP이 가장 빨리 매출로 연결되는가’** = STEP4 매칭(무료 체험) → STEP5 사업계획서(유료 전환). 따라서 앞단 데이터 구조·추천 품질을 먼저 안정화.
> 각 Phase의 기간·인력은 별도 WBS 협의. 본 문서는 **기능 범위·우선순위·검증 기준** 정의에 집중.

---

# 12. 리스크 & 미결정 사항(Open Questions)

| # | 리스크 / 미결정 | 영향 | 대응/결정 필요 |
|---|---|---|---|
| R1 | 외부 크롤링 자격조건이 **비정형 텍스트** | 매칭 정확도 급락 | 공고당 자격 태깅(정형화) 별도 공수 산정 — **선결정 필요** |
| R2 | 매칭 가중치 초기값 근거 부족 | 추천 신뢰도 | 실제 합격/탈락 데이터 누적 후 피드백 루프(P6) |
| R3 | 사업계획서 양식이 **hwp 중심** 요구 | 다운로드 호환 | docx 우선, hwp 변환 백로그 — **수요 검증 후 결정** |
| R4 | AI 재학습/프라이버시 약관 | 법적·신뢰 | 사용 모델 API 약관 확인 + 고지 — **계약 전 확인** |
| R5 | STEP3 내부 코드네임 노출 사고 | 브랜드·법무 | 후처리 필터 + TC-3.2 CI 게이트(상시) |
| R6 | 결제 재생성 과금 정책 미정 | 매출·CS 분쟁 | 섹션 재생성 무제한 vs 횟수 — **출시 전 확정** |
| R7 | 공고 마감 실시간성 | ‘마감 공고 추천’ | 일 1회+ 동기화 + D-day UI(AC-4.5) |

---

## 부록 A. 출처

- 클로드판: `doc/(클로드)제로백스쿨_서비스구축기획서.docx` — 7-Step 명세·화면·스키마·과금·로드맵.
- GPT판: `doc/(GPT)제로백스쿨_정부지원사업 매칭·작성·발표 AI 플랫폼 서비스 구축 기획서.docx` — 시장 포지셔닝·4층 데이터·canonical schema·컴플라이언스·KPI.
- 1차 운영 사이트: **제로백스쿨** 1차 랜딩 (코드 저장소·패키지명은 `iroun-start`) — Express 4 + PostgreSQL, Cloud Run.

## 부록 B. 변경 이력

| 버전 | 일자 | 내용 |
|---|---|---|
| v1.0 | 2026-06-30 | 두 기획서 통합 + DDD/SDD/TDD 재구조화 초판 |

