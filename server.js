require('dotenv').config();
const express   = require('express');
const { Pool }  = require('pg');
const session   = require('express-session');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const bcrypt    = require('bcryptjs');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');

const app    = express();
const isProd = process.env.NODE_ENV === 'production';

// ── 필수 환경변수 검증 ─────────────────────────────────
// 운영(production)에서 누락 시 부팅을 차단한다. 알려진 기본값으로 가동되는 사고 방지.
const REQUIRED_ENV = ['DATABASE_URL', 'SESSION_SECRET', 'ADMIN_PASSWORD'];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
const KAKAO_REST_KEY = process.env.KAKAO_REST_API_KEY || '';
if (missingEnv.length) {
  if (isProd) {
    console.error('❌ 필수 환경변수 누락(운영 부팅 차단):', missingEnv.join(', '));
    process.exit(1);
  }
  console.warn('⚠️  개발 모드 — 누락 환경변수에 안전하지 않은 폴백 사용:', missingEnv.join(', '));
}

app.set('trust proxy', 1); // Cloud Run이 HTTPS를 종료하므로 secure 쿠키 인식을 위해 필요

// ── DB 풀 ──────────────────────────────────────────────
// Cloud SQL db-f1-micro는 max_connections가 낮음(≈25). Cloud Run 인스턴스마다 풀이 열리므로
// 풀을 작게(max) + 유휴 커넥션을 빨리 반환(idleTimeout)해서 커넥션 고갈을 방지한다.
// 총 커넥션 ≈ (Cloud Run max-instances) × PG_POOL_MAX + 마이그레이션(1). max-instances는 배포 시 제한.
const dbUrl  = process.env.DATABASE_URL || '';
const useSSL = !dbUrl.includes('/cloudsql/') && !dbUrl.includes('localhost') && !dbUrl.includes('127.0.0.1');
const pool   = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  max: parseInt(process.env.PG_POOL_MAX || '5', 10), // 인스턴스당 최대 커넥션 (f1-micro 대비 보수적)
  idleTimeoutMillis: 10000,      // 유휴 10초 후 커넥션 반환/종료 — "바로바로 끊기"
  connectionTimeoutMillis: 5000, // 풀 고갈 시 무한 대기 대신 5초 내 실패
  allowExitOnIdle: true,         // 유휴 시 커넥션 정리 허용
});

// ── 보안 헤더 ──────────────────────────────────────────
// CSP 활성화. 외부 origin은 Pretendard(cdn.jsdelivr.net)·Space Grotesk(fonts.googleapis/gstatic) 뿐.
// script-src는 인라인 이벤트 핸들러(onclick 등)가 정적 HTML 전반에 있어 'unsafe-inline' 유지.
//   → 보완 통제: 모든 사용자 입력은 렌더 직전 esc()/express-validator로 이스케이프(소스단 XSS 차단).
//   외부 스크립트 로드·object/embed·클릭재킹(frame-ancestors)·폼 외부유출(form-action)·base-uri 탈취는 차단.
const IS_PROD = process.env.NODE_ENV === 'production';
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  frameguard: { action: 'deny' }, // frame-ancestors 'none' 과 일치(클릭재킹 차단)
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc:  ["'self'"],
      baseUri:     ["'self'"],
      objectSrc:   ["'none'"],
      frameSrc:    ["'none'", 'https://www.youtube.com'],
      frameAncestors: ["'none'"],
      formAction:  ["'self'"],
      imgSrc:      ["'self'", 'data:', 'https://img.youtube.com'],
      scriptSrc:   ["'self'", "'unsafe-inline'"],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'],
      fontSrc:     ["'self'", 'https://cdn.jsdelivr.net', 'https://fonts.gstatic.com', 'data:'],
      connectSrc:  ["'self'"],
      // prod(HTTPS)에서만 혼합 콘텐츠 업그레이드 — 로컬 http 개발은 제외
      ...(IS_PROD ? { upgradeInsecureRequests: [] } : {}),
    },
  },
}));

// ── 파서 · 정적 · 세션 ─────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// DB 연결 시 pg 세션 스토어, 없으면 MemoryStore 폴백(개발용)
const sessionStore = process.env.DATABASE_URL
  ? new pgSession({ pool, tableName: 'session', createTableIfMissing: false })
  : undefined;
app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000,
    secure: isProd,
    httpOnly: true,
    sameSite: 'lax',
  },
}));

// ── CSRF 방어 (sameSite=lax 쿠키 1차 + Origin/Referer 호스트 검증 2차) ──
// 상태 변경 요청(POST/PUT/PATCH/DELETE)에서 출처 호스트가 요청 호스트와 "다를 때만" 차단한다.
// Origin 이 없거나 'null'(불투명 출처: 일부 브라우저·리다이렉트·프라이버시 설정)인 경우는
// SameSite=lax 세션 쿠키 방어에 의존하고 통과시킨다 — 정상 사용자를 오차단하지 않기 위함.
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const host = req.get('host') || '';
    const raw  = req.get('origin') || req.get('referer') || '';
    if (raw && raw !== 'null' && host) {
      let originHost = '';
      try { originHost = new URL(raw).host; } catch (_) { originHost = ''; }
      if (originHost && originHost !== host) {
        return res.status(403).json({ success: false, message: '요청 출처가 올바르지 않습니다.' });
      }
    }
  }
  next();
});

// ── Rate limiters ──────────────────────────────────────
const submitLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
});
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

function requireAdmin(req, res, next) {
  // 레거시 단일 비번 세션(isAdmin) 또는 회원 role=admin 둘 다 허용
  if (req.session && (req.session.isAdmin || req.session.role === 'admin')) return next();
  res.redirect('/admin/login');
}

// 회원(로그인) 전용 API 가드
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
}

// CSV 수식 인젝션 방어(=, +, -, @ 로 시작하는 셀 무력화)
const csvSafe = (v) => {
  const s = String(v ?? '');
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

const STATUS_VALUES = ['pending', 'contacted', 'completed'];

// ═══════════════════════════════════════════════════════
//  공개 API
// ═══════════════════════════════════════════════════════

// 폼 제출 (rate limit + 입력 검증)
app.post(
  '/api/submit',
  submitLimiter,
  body('type').isIn(['예비창업자', '소상공인']),
  body('name').trim().isLength({ min: 1, max: 50 }),
  body('phone').trim().matches(/^[0-9\-+\s()]{7,20}$/),
  body('message').optional({ nullable: true }).isLength({ max: 2000 }),
  body('companyName').optional({ nullable: true }).trim().isLength({ max: 100 }),
  body('consultType').optional({ nullable: true }).trim().isLength({ max: 100 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: '입력값을 확인해주세요.' });
    }
    try {
      const {
        type, name, phone, currentStatus, businessType,
        businessName, industry, operationPeriod, employeeCount,
        interests, message, companyName, consultType,
      } = req.body;

      const interestsArr = Array.isArray(interests) ? interests.slice(0, 10)
        : interests ? [interests] : [];

      const { rows } = await pool.query(
        `INSERT INTO submissions
           (type, name, phone, current_status, business_type,
            business_name, industry, operation_period, employee_count,
            interests, message, company_name, consult_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id`,
        [type, name, phone,
         currentStatus || null, businessType || null,
         businessName || null, industry || null,
         operationPeriod || null, employeeCount || null,
         interestsArr, message || null,
         companyName || null, consultType || null],
      );

      res.json({ success: true, id: rows[0].id });
    } catch (err) {
      console.error('submit error:', err.message);
      res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
    }
  },
);

// ═══════════════════════════════════════════════════════
//  회원 인증 (가입 · 로그인 · 세션)
// ═══════════════════════════════════════════════════════

app.post(
  '/api/auth/signup',
  authLimiter,
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8, max: 100 }),
  body('name').trim().isLength({ min: 1, max: 50 }),
  body('phone').optional({ nullable: true }).matches(/^[0-9\-+\s()]{7,20}$/),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, message: '입력값을 확인해주세요.' });
    try {
      const { email, password, name, phone } = req.body;
      const hash = await bcrypt.hash(password, 12);
      const { rows } = await pool.query(
        `INSERT INTO users (email, password_hash, name, phone)
         VALUES ($1,$2,$3,$4) RETURNING id, email, name, role`,
        [email, hash, name, phone || null],
      );
      req.session.userId = rows[0].id;
      req.session.role   = rows[0].role;
      res.json({ success: true, user: rows[0] });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ success: false, message: '이미 가입된 이메일입니다.' });
      console.error('signup error:', err.message);
      res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
    }
  },
);

app.post(
  '/api/auth/login',
  authLimiter,
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 1 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, message: '입력값을 확인해주세요.' });
    try {
      const { email, password } = req.body;
      const { rows } = await pool.query(
        `SELECT id, email, name, role, password_hash FROM users WHERE email = $1`, [email],
      );
      const user = rows[0];
      if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
      }
      req.session.userId = user.id;
      req.session.role   = user.role;
      res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
    } catch (err) {
      console.error('login error:', err.message);
      res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
    }
  },
);

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth/me', async (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ authenticated: false });
  try {
    const { rows } = await pool.query(`SELECT id, email, name, role FROM users WHERE id = $1`, [req.session.userId]);
    if (!rows[0]) return res.status(401).json({ authenticated: false });
    res.json({ authenticated: true, user: rows[0] });
  } catch (err) {
    res.status(500).json({ authenticated: false });
  }
});

// ═══════════════════════════════════════════════════════
//  STEP1 — 고객 프로필 (마스터 프로필 빌더)
// ═══════════════════════════════════════════════════════

// 세그먼트 마스터(9종, 코드성)
app.get('/api/segments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT code, label, definition FROM segment_master WHERE active = true ORDER BY sort_order`,
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: '세그먼트 조회 실패' });
  }
});

// 내 프로필 조회
app.get('/api/profile', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM customer_profile WHERE user_id = $1`, [req.session.userId]);
    if (!rows[0]) return res.json({ profile: null, business: null });
    const business = await pool.query(`SELECT * FROM profile_business WHERE profile_id = $1`, [rows[0].id]);
    res.json({ profile: rows[0], business: business.rows[0] || null });
  } catch (err) {
    console.error('profile get error:', err.message);
    res.status(500).json({ error: '프로필 조회 실패' });
  }
});

// 내 프로필 생성/수정 (upsert) — 한 번 입력하면 전 단계 재사용
app.post(
  '/api/profile',
  requireAuth,
  body('bizName').trim().isLength({ min: 1, max: 150 }),
  body('segments').isArray({ min: 1 }).withMessage('세그먼트를 1개 이상 선택해주세요.'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, message: '필수 항목을 확인해주세요.' });
    try {
      const u = req.session.userId;
      const {
        bizName, foundedYear, industryCode, regionSido, regionSigungu,
        employeeCnt, revenueBand, segments,
        bizSummary, productDesc, coreTech, competitiveEdge,
      } = req.body;

      const segs = Array.isArray(segments) ? segments.slice(0, 9) : [];
      const empCnt = Number.isInteger(employeeCnt) ? employeeCnt : (parseInt(employeeCnt) || null);

      const { rows } = await pool.query(
        `INSERT INTO customer_profile
           (user_id, biz_name, founded_year, industry_code, region_sido, region_sigungu, employee_cnt, revenue_band, segments, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           biz_name=$2, founded_year=$3, industry_code=$4, region_sido=$5, region_sigungu=$6,
           employee_cnt=$7, revenue_band=$8, segments=$9, updated_at=NOW()
         RETURNING id`,
        [u, bizName, foundedYear || null, industryCode || null, regionSido || null,
         regionSigungu || null, empCnt, revenueBand || null, segs],
      );
      const pid = rows[0].id;

      await pool.query(
        `INSERT INTO profile_business (profile_id, biz_summary, product_desc, core_tech, competitive_edge)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (profile_id) DO UPDATE SET
           biz_summary=$2, product_desc=$3, core_tech=$4, competitive_edge=$5`,
        [pid, bizSummary || null, productDesc || null, coreTech || null, competitiveEdge || null],
      );

      res.json({ success: true, profileId: pid });
    } catch (err) {
      console.error('profile save error:', err.message);
      res.status(500).json({ success: false, message: '저장에 실패했습니다.' });
    }
  },
);

// ═══════════════════════════════════════════════════════
//  STEP4 — 정부지원사업 매칭 (룰 기반, AI 임베딩 제외)
// ═══════════════════════════════════════════════════════

// 설립연도 → 사업 단계 도출
function deriveStages(profile) {
  const stages = [];
  const fy = profile.founded_year;
  if (fy === '설립 전') stages.push('예비');
  else if (['2026', '2025'].includes(fy)) stages.push('1년미만');
  else if (['2024', '2023'].includes(fy)) stages.push('1-3년');
  else if (fy) stages.push('3-7년');
  if ((profile.segments || []).includes('SMB')) stages.push('소상공인');
  if (!stages.length) stages.push('예비');
  return stages;
}

// 프로필 × 공고 룰 기반 매칭
function matchProgram(profile, program) {
  const pSegs = profile.segments || [];
  const tSegs = program.target_segments || [];
  const segOverlap = tSegs.filter((s) => pSegs.includes(s));
  const stages = deriveStages(profile);
  const stageMatch = (program.target_stages || []).some((s) => stages.includes(s));
  const industries = program.target_industries || [];
  const industryMatch = industries.length === 0
    || (profile.industry_code && industries.includes(profile.industry_code));

  // 하드필터: 특정 업종 대상인데 불일치 → 탈락 / 세그먼트·단계 모두 불일치 → 탈락
  if (industries.length > 0 && !industryMatch) return { hardPass: false };
  if (segOverlap.length === 0 && !stageMatch) return { hardPass: false };

  // 소프트 스코어
  const segScore      = tSegs.length ? segOverlap.length / tSegs.length : 0.5;
  const stageScore    = stageMatch ? 1 : 0.3;
  const industryScore = industryMatch ? 1 : 0.5;
  const breakdown = {
    segment:  Math.round(segScore * 50),
    stage:    Math.round(stageScore * 25),
    industry: Math.round(industryScore * 15),
    base:     6,
  };
  let score = breakdown.segment + breakdown.stage + breakdown.industry + breakdown.base;
  score = Math.max(0, Math.min(100, score));

  const evidence = [];
  if (segOverlap.length) evidence.push(`세그먼트 일치 (${segOverlap.join(', ')})`);
  if (stageMatch)        evidence.push('사업 단계 적합');
  if (industries.length === 0) evidence.push('전 업종 대상');
  else if (industryMatch)      evidence.push('업종 적합');

  return { hardPass: true, score, breakdown, evidence };
}

// 내 매칭 결과 (매칭률 순)
app.get('/api/match', requireAuth, async (req, res) => {
  try {
    const pr = await pool.query(`SELECT * FROM customer_profile WHERE user_id = $1`, [req.session.userId]);
    const profile = pr.rows[0];
    if (!profile) return res.status(400).json({ error: '먼저 프로필을 입력해주세요.', needProfile: true });

    const progs = await pool.query(`SELECT * FROM gov_program`);
    const matches = progs.rows
      .map((p) => {
        const m = matchProgram(profile, p);
        if (!m.hardPass) return null;
        return {
          program_id: p.program_id, name: p.name, agency: p.agency, field: p.field,
          amount_text: p.amount_text, region: p.region, summary: p.summary,
          matchScore: m.score, scoreBreakdown: m.breakdown, evidence: m.evidence,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.matchScore - a.matchScore);

    res.json({ total: matches.length, matches });
  } catch (err) {
    console.error('match error:', err.message);
    res.status(500).json({ error: '매칭에 실패했습니다.' });
  }
});

// 공고 상세
app.get('/api/programs/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM gov_program WHERE program_id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: '공고를 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: '조회 실패' });
  }
});

// ═══════════════════════════════════════════════════════
//  STEP2 — 아이템 정의 + AI 사업아이템명 (생성은 목업)
// ═══════════════════════════════════════════════════════

// 아이템 정의 저장 (4개 입력 → item_* 테이블)
app.post('/api/items', requireAuth, async (req, res) => {
  try {
    const pr = await pool.query(`SELECT id FROM customer_profile WHERE user_id=$1`, [req.session.userId]);
    if (!pr.rows[0]) return res.status(400).json({ error: '먼저 프로필을 입력해주세요.', needProfile: true });
    const pid = pr.rows[0].id;
    const b = req.body;
    // 차별화 전략은 공백 제거 후 정확히 3개 (문서화된 불변식 서버측 강제)
    const strat = Array.isArray(b.strategies) ? b.strategies.map((x) => (x || '').trim()).filter(Boolean) : [];
    if (strat.length !== 3) return res.status(400).json({ error: '차별화 전략 3가지를 모두 입력해주세요.' });
    await pool.query(`INSERT INTO item_overview (profile_id,usage_spec_price,core_function,customer_benefit) VALUES ($1,$2,$3,$4)
      ON CONFLICT (profile_id) DO UPDATE SET usage_spec_price=$2,core_function=$3,customer_benefit=$4`,
      [pid, b.usageSpecPrice || null, b.coreFunction || null, b.customerBenefit || null]);
    await pool.query(`INSERT INTO item_problem (profile_id,market_status,problem_point,necessity) VALUES ($1,$2,$3,$4)
      ON CONFLICT (profile_id) DO UPDATE SET market_status=$2,problem_point=$3,necessity=$4`,
      [pid, b.marketStatus || null, b.problemPoint || null, b.necessity || null]);
    await pool.query(`INSERT INTO item_feasibility (profile_id,dev_plan,output_form,output_qty) VALUES ($1,$2,$3,$4)
      ON CONFLICT (profile_id) DO UPDATE SET dev_plan=$2,output_form=$3,output_qty=$4`,
      [pid, b.devPlan || null, b.outputForm || null, b.outputQty || null]);
    const s = strat;
    await pool.query(`INSERT INTO item_differentiation (profile_id,strategy_1,strategy_2,strategy_3) VALUES ($1,$2,$3,$4)
      ON CONFLICT (profile_id) DO UPDATE SET strategy_1=$2,strategy_2=$3,strategy_3=$4`,
      [pid, s[0] || null, s[1] || null, s[2] || null]);
    res.json({ success: true });
  } catch (err) { console.error('items error:', err.message); res.status(500).json({ error: '저장 실패' }); }
});

// AI 사업아이템명 3안 생성
app.post('/api/items/name-suggestions', requireAuth, async (req, res) => {
  try {
    const pr = await pool.query(`SELECT cp.*, io.core_function, io.customer_benefit, ip.problem_point
      FROM customer_profile cp
      LEFT JOIN item_overview io ON io.profile_id=cp.id
      LEFT JOIN item_problem ip ON ip.profile_id=cp.id
      WHERE cp.user_id=$1`, [req.session.userId]);
    const p = pr.rows[0];
    if (!p) return res.status(400).json({ error: '먼저 프로필을 입력해주세요.', needProfile: true });
    // 아이템(개요/문제) 미입력 시 차단 — LEFT JOIN이라 프로필만 있으면 p가 truthy이므로 명시 검사
    if (p.core_function == null && p.customer_benefit == null && p.problem_point == null)
      return res.status(400).json({ error: '먼저 아이템을 입력해주세요.', needItem: true });

    // ── 목업 생성 ── // TODO: AI 연동 (LLM API로 합격형 아이템명 3안 생성)
    const kw = p.core_function || p.core_tech || p.industry_code || '혁신 기술';
    const benefit = p.customer_benefit || '맞춤형';
    const target = (p.segments || []).includes('SMB') ? '소상공인' : '창업기업';
    const problem = p.problem_point || '시장의 비효율';
    const mock = [
      { type: '기술중심', text: `${kw} 기반 ${benefit} 솔루션` },
      { type: '혜택중심', text: `${target}을 위한 ${benefit} 올인원 플랫폼` },
      { type: '문제중심', text: `${problem}을(를) 해결하는 ${kw} 서비스` },
    ];
    await pool.query(`DELETE FROM item_name_suggestion WHERE profile_id=$1`, [p.id]);
    const out = [];
    for (const s of mock) {
      const r = await pool.query(`INSERT INTO item_name_suggestion (profile_id,suggestion_text,type) VALUES ($1,$2,$3) RETURNING id,suggestion_text,type,selected`, [p.id, s.text, s.type]);
      out.push(r.rows[0]);
    }
    res.json({ mock: true, suggestions: out });
  } catch (err) { console.error('namegen error:', err.message); res.status(500).json({ error: '생성 실패' }); }
});

// 아이템명 선택
app.patch('/api/items/name-suggestions/:id/select', requireAuth, async (req, res) => {
  try {
    const pr = await pool.query(`SELECT id FROM customer_profile WHERE user_id=$1`, [req.session.userId]);
    if (!pr.rows[0]) return res.status(400).json({ error: '프로필 없음' });
    const pid = pr.rows[0].id;
    await pool.query(`UPDATE item_name_suggestion SET selected=false WHERE profile_id=$1`, [pid]);
    await pool.query(`UPDATE item_name_suggestion SET selected=true WHERE id=$1 AND profile_id=$2`, [parseInt(req.params.id), pid]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: '선택 실패' }); }
});

// ═══════════════════════════════════════════════════════
//  STEP3 — 전문 액셀러레이터 분석 (분석은 목업)
//  ⚠ 내부 프레임워크 명칭(YC/GStack)은 코드·응답·UI 어디에도 노출 금지
// ═══════════════════════════════════════════════════════
app.post('/api/analysis', requireAuth, async (req, res) => {
  try {
    const pr = await pool.query(`SELECT cp.*, io.core_function, io.customer_benefit, ip.problem_point, ip.market_status,
        idf.strategy_1, idf.strategy_2, idf.strategy_3
      FROM customer_profile cp
      LEFT JOIN item_overview io ON io.profile_id=cp.id
      LEFT JOIN item_problem ip ON ip.profile_id=cp.id
      LEFT JOIN item_differentiation idf ON idf.profile_id=cp.id
      WHERE cp.user_id=$1`, [req.session.userId]);
    const p = pr.rows[0];
    if (!p) return res.status(400).json({ error: '프로필을 먼저 입력해주세요.' });

    // ── 목업 분석 ── // TODO: AI 연동 (점수·코멘트를 LLM으로 생성. 대외 명칭은 '전문 액셀러레이터 분석')
    const len = (s) => (s || '').length;
    const sc = (s) => Math.min(5, Math.max(2, 2 + Math.floor(len(s) / 30)));
    const stratCount = [p.strategy_1, p.strategy_2, p.strategy_3].filter(Boolean).length;
    const scores = {
      problem_fit: sc(p.problem_point), market: sc(p.market_status),
      founder_fit: sc(p.core_tech),
      differentiation: stratCount >= 3 ? 5 : (stratCount === 2 ? 4 : 3),
      scalability: sc(p.customer_benefit),
    };
    const a = await pool.query(`INSERT INTO accelerator_analysis
        (profile_id,problem_fit_score,market_score,founder_fit_score,differentiation_score,scalability_score)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [p.id, scores.problem_fit, scores.market, scores.founder_fit, scores.differentiation, scores.scalability]);
    const aid = a.rows[0].id;
    const areas = [
      ['문제-해결 적합성', scores.problem_fit], ['시장 크기·성장성', scores.market],
      ['실행 역량', scores.founder_fit], ['차별성·진입장벽', scores.differentiation], ['확장 가능성', scores.scalability],
    ];
    const sorted = [...areas].sort((x, y) => y[1] - x[1]);
    const strengths = sorted.slice(0, 3).map(([area]) => ({ area, text: `${area} — 입력 내용 기준 강점으로 평가됩니다.` }));
    const gaps = sorted.slice(-3).reverse().map(([area]) => ({ area, text: `${area} — 구체적 근거·정량 목표 보강을 권장합니다.` }));
    for (const s of strengths) await pool.query(`INSERT INTO accelerator_comment (analysis_id,area,comment_text,type) VALUES ($1,$2,$3,'강점')`, [aid, s.area, s.text]);
    for (const g of gaps) await pool.query(`INSERT INTO accelerator_comment (analysis_id,area,comment_text,type) VALUES ($1,$2,$3,'보완')`, [aid, g.area, g.text]);

    res.json({ mock: true, analysisId: aid, scores, strengths, gaps });
  } catch (err) { console.error('analysis error:', err.message); res.status(500).json({ error: '분석 실패' }); }
});

// ═══════════════════════════════════════════════════════
//  STEP5 — 사업계획서 (생성은 목업)
// ═══════════════════════════════════════════════════════
const PLAN_SECTIONS = [
  { key: 'problem',     title: '1. 문제 인식' },
  { key: 'feasibility', title: '2. 실현 가능성' },
  { key: 'growth',      title: '3. 성장 전략' },
  { key: 'team',        title: '4. 팀 구성' },
];

// 공고 선택 → 지원 건 + 사업계획서 초안 생성
app.post('/api/plans/generate', requireAuth, async (req, res) => {
  try {
    const { programId } = req.body;
    if (!programId) return res.status(400).json({ error: '공고를 선택해주세요.' });
    const pr = await pool.query(`SELECT cp.*, io.core_function, io.customer_benefit, ip.problem_point,
        ins.suggestion_text AS item_name
      FROM customer_profile cp
      LEFT JOIN item_overview io ON io.profile_id=cp.id
      LEFT JOIN item_problem ip ON ip.profile_id=cp.id
      LEFT JOIN item_name_suggestion ins ON ins.profile_id=cp.id AND ins.selected=true
      WHERE cp.user_id=$1`, [req.session.userId]);
    const p = pr.rows[0];
    if (!p) return res.status(400).json({ error: '먼저 프로필을 입력해주세요.' });
    const prog = await pool.query(`SELECT name FROM gov_program WHERE program_id=$1`, [programId]);
    // 존재하지 않는 공고 → application FK 위반(500) 대신 우아한 400
    if (!prog.rows[0]) return res.status(400).json({ error: '유효하지 않은 공고입니다.' });
    const progName = prog.rows[0].name;

    const app = await pool.query(`INSERT INTO application (user_id,program_id,status) VALUES ($1,$2,'PLAN_DRAFTING')
      ON CONFLICT (user_id,program_id) DO UPDATE SET status='PLAN_DRAFTING',updated_at=NOW() RETURNING id`,
      [req.session.userId, programId]);
    const appId = app.rows[0].id;
    let planRow = await pool.query(`SELECT id FROM business_plan WHERE application_id=$1`, [appId]);
    let planId;
    if (planRow.rows[0]) { planId = planRow.rows[0].id; await pool.query(`DELETE FROM business_plan_section WHERE plan_id=$1`, [planId]); }
    else { const pl = await pool.query(`INSERT INTO business_plan (application_id) VALUES ($1) RETURNING id`, [appId]); planId = pl.rows[0].id; }

    // ── 목업 섹션 ── // TODO: AI 연동 (공고문 파싱 + RAG로 섹션 생성)
    const name = p.item_name || p.biz_name || '본 사업';
    const body = {
      problem: `「${progName}」 지원을 위한 문제 인식\n\n${p.problem_point || '대상 시장에는 해결되지 않은 문제가 존재합니다.'} 본 사업 「${name}」은 이 문제를 정조준합니다.\n\n(목업 — AI 연동 시 공고 평가항목·시장데이터 기반 자동 작성)`,
      feasibility: `실현 가능성\n\n${p.core_function || '핵심 기능'}을 통해 ${p.customer_benefit || '고객 가치'}를 제공합니다. 사업기간 내 MVP 개발·검증을 완료할 계획입니다.\n\n(목업)`,
      growth: `성장 전략\n\n초기 목표 시장을 확보한 뒤 인접 시장으로 확장합니다. 정부지원사업 선정으로 성장을 가속합니다.\n\n(목업)`,
      team: `팀 구성\n\n대표자의 ${p.core_tech || '전문성'}을 중심으로 핵심 인력을 구성합니다.\n\n(목업)`,
    };
    for (const s of PLAN_SECTIONS) {
      await pool.query(`INSERT INTO business_plan_section (plan_id,section_key,section_title,content,ai_generated) VALUES ($1,$2,$3,$4,true)`,
        [planId, s.key, s.title, body[s.key]]);
    }
    res.json({ mock: true, applicationId: appId, planId, programName: progName });
  } catch (err) { console.error('plan gen error:', err.message); res.status(500).json({ error: '생성에 실패했습니다.' }); }
});

app.get('/api/plans/:planId', requireAuth, async (req, res) => {
  try {
    const planId = parseInt(req.params.planId);
    const own = await pool.query(`SELECT bp.id FROM business_plan bp JOIN application a ON a.id=bp.application_id WHERE bp.id=$1 AND a.user_id=$2`, [planId, req.session.userId]);
    if (!own.rows[0]) return res.status(404).json({ error: '없음' });
    const secs = await pool.query(`SELECT section_key,section_title,content,version FROM business_plan_section WHERE plan_id=$1 ORDER BY id`, [planId]);
    res.json({ planId, sections: secs.rows });
  } catch (err) { res.status(500).json({ error: '조회 실패' }); }
});

// 섹션 재생성 (목업)
app.post('/api/plans/:planId/sections/:key/regenerate', requireAuth, async (req, res) => {
  try {
    const planId = parseInt(req.params.planId);
    const own = await pool.query(`SELECT bp.id FROM business_plan bp JOIN application a ON a.id=bp.application_id WHERE bp.id=$1 AND a.user_id=$2`, [planId, req.session.userId]);
    if (!own.rows[0]) return res.status(404).json({ error: '없음' });
    // ── 목업 ── // TODO: AI 연동 (해당 섹션만 재생성)
    const content = `[재생성됨] 이 섹션은 새로 생성된 샘플 내용입니다. 실제 재생성은 순차 오픈됩니다.`;
    const upd = await pool.query(`UPDATE business_plan_section SET content=$1,version=version+1 WHERE plan_id=$2 AND section_key=$3`, [content, planId, req.params.key]);
    if (upd.rowCount === 0) return res.status(404).json({ error: '섹션을 찾을 수 없습니다.' });
    res.json({ success: true, content });
  } catch (err) { res.status(500).json({ error: '재생성 실패' }); }
});

// ═══════════════════════════════════════════════════════
//  STEP6 — 발표 슬라이드 (생성은 목업)
// ═══════════════════════════════════════════════════════
app.post('/api/decks/generate', requireAuth, async (req, res) => {
  try {
    const planId = parseInt(req.body.planId);
    const own = await pool.query(`SELECT bp.id FROM business_plan bp JOIN application a ON a.id=bp.application_id WHERE bp.id=$1 AND a.user_id=$2`, [planId, req.session.userId]);
    if (!own.rows[0]) return res.status(404).json({ error: '사업계획서를 먼저 생성해주세요.' });
    let deckRow = await pool.query(`SELECT id FROM pitch_deck WHERE plan_id=$1`, [planId]);
    let deckId;
    if (deckRow.rows[0]) { deckId = deckRow.rows[0].id; await pool.query(`DELETE FROM pitch_deck_slide WHERE deck_id=$1`, [deckId]); }
    else { const d = await pool.query(`INSERT INTO pitch_deck (plan_id) VALUES ($1) RETURNING id`, [planId]); deckId = d.rows[0].id; }

    // ── 목업 표준 슬라이드 ── // TODO: AI 연동 (사업계획서 → 슬라이드 압축·시각화)
    const slides = [
      ['표지', '사업 아이템명 · 대표자명'], ['문제인식', '시장 현황 및 문제점'],
      ['솔루션', '제품·서비스 개요'], ['차별성', '차별화 전략 3가지'],
      ['실현가능성', '마일스톤 타임라인'], ['시장성', '시장 규모·확장 계획'],
      ['팀', '대표자 경력·역량'], ['자금운용', '지원금 사용 계획'], ['클로징', '한 줄 요약'],
    ];
    let i = 1;
    for (const [type, head] of slides) {
      await pool.query(`INSERT INTO pitch_deck_slide (deck_id,order_no,slide_type,headline,body_content,visual_suggestion) VALUES ($1,$2,$3,$4,$5,$6)`,
        [deckId, i++, type, head, `${type} 슬라이드 본문 (목업)`, '표/그래프/이미지 제안 (목업)']);
    }
    res.json({ mock: true, deckId, slideCount: slides.length });
  } catch (err) { console.error('deck gen error:', err.message); res.status(500).json({ error: '생성에 실패했습니다.' }); }
});

app.get('/api/decks/:deckId', requireAuth, async (req, res) => {
  try {
    const deckId = parseInt(req.params.deckId);
    // 소유검사: deck → business_plan → application → 세션 사용자 (미소유/미존재는 404)
    const own = await pool.query(
      `SELECT pd.id FROM pitch_deck pd
         JOIN business_plan bp ON bp.id = pd.plan_id
         JOIN application a   ON a.id = bp.application_id
       WHERE pd.id = $1 AND a.user_id = $2`,
      [deckId, req.session.userId]);
    if (!own.rows[0]) return res.status(404).json({ error: '없음' });
    const slides = await pool.query(`SELECT order_no,slide_type,headline,body_content,visual_suggestion FROM pitch_deck_slide WHERE deck_id=$1 ORDER BY order_no`, [deckId]);
    res.json({ deckId, slides: slides.rows });
  } catch (err) { res.status(500).json({ error: '조회 실패' }); }
});

// ═══════════════════════════════════════════════════════
//  STEP7 — 전문가 컨설팅 연계 (무료 신청, 회원 컨텍스트 첨부)
// ═══════════════════════════════════════════════════════
app.post('/api/consulting', requireAuth, async (req, res) => {
  try {
    const { area, message, applicationId } = req.body;
    const pr = await pool.query(`SELECT biz_name, segments, industry_code, region_sido FROM customer_profile WHERE user_id=$1`, [req.session.userId]);
    const me = await pool.query(`SELECT name, email, phone FROM users WHERE id=$1`, [req.session.userId]);
    const context = { profile: pr.rows[0] || null, user: me.rows[0] || null };
    await pool.query(`INSERT INTO consulting_request (user_id, application_id, area, message, context) VALUES ($1,$2,$3,$4,$5)`,
      [req.session.userId, applicationId || null, (area || '').slice(0, 50), (message || '').slice(0, 2000), JSON.stringify(context)]);
    res.json({ success: true });
  } catch (err) { console.error('consulting error:', err.message); res.status(500).json({ error: '신청에 실패했습니다.' }); }
});

// ═══════════════════════════════════════════════════════
//  카카오 OAuth 2.0
// ═══════════════════════════════════════════════════════

app.get('/auth/kakao', authLimiter, (req, res) => {
  if (!KAKAO_REST_KEY) return res.status(503).send('카카오 로그인을 사용할 수 없습니다.');
  const redirectUri = `${req.protocol}://${req.get('host')}/auth/kakao/callback`;
  const url = `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_REST_KEY}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
  res.redirect(url);
});

app.get('/auth/kakao/callback', authLimiter, async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/app?error=kakao_cancel');
  const redirectUri = `${req.protocol}://${req.get('host')}/auth/kakao/callback`;
  try {
    // 인가 코드 → 액세스 토큰 교환
    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: KAKAO_REST_KEY,
        redirect_uri: redirectUri,
        code,
      }).toString(),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('kakao token error:', JSON.stringify(tokenData));
      return res.redirect('/app?error=kakao_token');
    }

    // 카카오 사용자 정보 조회
    const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const kakaoUser = await userRes.json();
    console.log('kakao user raw:', JSON.stringify(kakaoUser));

    const kakaoId = String(kakaoUser.id);
    const nickname = kakaoUser.kakao_account?.profile?.nickname || '카카오 사용자';
    const email    = kakaoUser.kakao_account?.email || null;

    // 기존 회원이면 바로 로그인, 신규면 약관 동의 화면으로
    const { rows } = await pool.query('SELECT id, role FROM users WHERE kakao_id = $1', [kakaoId]);
    if (rows[0]) {
      req.session.userId = rows[0].id;
      req.session.role   = rows[0].role;
      return res.redirect('/app');
    }

    req.session.pendingKakao = { kakaoId, nickname, email };
    res.redirect('/auth/kakao/terms');
  } catch (err) {
    console.error('kakao callback error:', err.message, err.stack);
    res.redirect('/app?error=kakao_error');
  }
});

app.get('/auth/kakao/terms', (req, res) => {
  if (!req.session.pendingKakao) return res.redirect('/app');
  res.sendFile(path.join(__dirname, 'public', 'kakao-terms.html'));
});

app.get('/auth/kakao/pending-info', (req, res) => {
  if (!req.session.pendingKakao) return res.json({});
  const { nickname, email } = req.session.pendingKakao;
  res.json({ nickname, email });
});

app.post('/auth/kakao/agree', authLimiter, async (req, res) => {
  const pending = req.session.pendingKakao;
  if (!pending) return res.status(400).json({ success: false, message: '세션이 만료됐습니다. 다시 시도해주세요.' });
  try {
    const ins = await pool.query(
      `INSERT INTO users (kakao_id, name, email, auth_provider) VALUES ($1, $2, $3, 'kakao') RETURNING id, role`,
      [pending.kakaoId, pending.nickname, pending.email],
    );
    delete req.session.pendingKakao;
    req.session.userId = ins.rows[0].id;
    req.session.role   = ins.rows[0].role;
    res.json({ success: true });
  } catch (err) {
    console.error('kakao agree error:', err.message);
    res.status(500).json({ success: false, message: '가입 중 오류가 발생했습니다.' });
  }
});

// ═══════════════════════════════════════════════════════
//  워크스페이스 (회원 영역 진입점)
// ═══════════════════════════════════════════════════════
app.get('/app',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/terms',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));

// ═══════════════════════════════════════════════════════
//  어드민 인증
// ═══════════════════════════════════════════════════════

app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.post('/admin/login', loginLimiter, (req, res) => {
  const { password } = req.body;
  // NOTE: 단일 평문 비밀번호 인증은 P1에서 bcrypt 계정 기반으로 재구축 예정
  if (password === (process.env.ADMIN_PASSWORD || 'iroun2025!')) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.redirect('/admin/login?error=1');
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ═══════════════════════════════════════════════════════
//  어드민 페이지
// ═══════════════════════════════════════════════════════

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// ═══════════════════════════════════════════════════════
//  어드민 JSON API
// ═══════════════════════════════════════════════════════

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE TRUE)                  AS total,
        COUNT(*) FILTER (WHERE type = '예비창업자')   AS startup,
        COUNT(*) FILTER (WHERE type = '소상공인')     AS small,
        COUNT(*) FILTER (WHERE status = 'pending')    AS pending,
        COUNT(*) FILTER (WHERE status = 'contacted')  AS contacted,
        COUNT(*) FILTER (WHERE status = 'completed')  AS completed
      FROM submissions
    `);
    res.json(rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: '통계 조회 실패' });
  }
});

app.get('/api/admin/submissions', requireAdmin, async (req, res) => {
  try {
    const { type, status, q } = req.query;
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = 20;
    const offset = (page - 1) * limit;

    const conditions = ['1=1'];
    const params     = [];

    if (type)   { params.push(type);   conditions.push(`type = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
    if (q) {
      params.push(`%${q}%`);
      conditions.push(`(name ILIKE $${params.length} OR phone ILIKE $${params.length} OR business_name ILIKE $${params.length} OR company_name ILIKE $${params.length})`);
    }

    const where = conditions.join(' AND ');
    // limit/offset은 서버 상수·정수라 보간 안전
    const [dataRes, countRes] = await Promise.all([
      pool.query(`SELECT * FROM submissions WHERE ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`, params),
      pool.query(`SELECT COUNT(*) FROM submissions WHERE ${where}`, params),
    ]);

    res.json({ data: dataRes.rows, total: parseInt(countRes.rows[0].count), page, limit });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: '목록 조회 실패' });
  }
});

app.patch('/api/admin/submissions/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false });

    const { status, memo } = req.body;
    if (status !== undefined && !STATUS_VALUES.includes(status)) {
      return res.status(400).json({ success: false, message: '상태값 오류' });
    }

    const sets = [];
    const vals = [];
    if (status !== undefined) { vals.push(status); sets.push(`status=$${vals.length}`); }
    if (memo   !== undefined) { vals.push(String(memo).slice(0, 5000)); sets.push(`memo=$${vals.length}`); }
    if (!sets.length) return res.json({ success: true });

    vals.push(id);
    sets.push('updated_at=NOW()');
    await pool.query(`UPDATE submissions SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
    res.json({ success: true });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false });
  }
});

app.get('/api/admin/export', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM submissions ORDER BY created_at DESC');

    const header = ['ID','유형','기업명','이름','연락처','상담요청항목','현재상태','예정업종','상호명','업종','사업기간','직원수','관심사업','문의내용','어드민메모','상담상태','접수일'];
    const csvRows = rows.map((r) => [
      r.id, r.type, r.company_name || '', r.name, r.phone,
      r.consult_type || '',
      r.current_status || '', r.business_type || '',
      r.business_name  || '', r.industry      || '',
      r.operation_period || '', r.employee_count || '',
      (r.interests || []).join(' | '),
      r.message || '', r.memo || '', r.status,
      new Date(r.created_at).toLocaleString('ko-KR'),
    ]);

    const csv = [header, ...csvRows]
      .map((row) => row.map((v) => `"${csvSafe(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="submissions_${Date.now()}.csv"`);
    res.send('﻿' + csv); // BOM for Excel
  } catch (err) {
    console.error(err.message);
    res.status(500).send('내보내기 실패');
  }
});

// ── 어드민: 전문가 컨설팅 신청 (STEP7) ──
app.get('/api/admin/consulting', requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const conditions = ['1=1'];
    const params = [];
    if (status && STATUS_VALUES.includes(status)) {
      params.push(status);
      conditions.push(`cr.status = $${params.length}`);
    }
    const where = conditions.join(' AND ');
    const { rows } = await pool.query(`
      SELECT cr.id, cr.area, cr.message, cr.context, cr.status, cr.created_at,
             cr.application_id,
             u.name AS user_name, u.email AS user_email, u.phone AS user_phone
      FROM consulting_request cr
      LEFT JOIN users u ON u.id = cr.user_id
      WHERE ${where}
      ORDER BY cr.created_at DESC
    `, params);
    res.json({ data: rows });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: '컨설팅 목록 조회 실패' });
  }
});

app.patch('/api/admin/consulting/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false });

    const { status } = req.body;
    if (!STATUS_VALUES.includes(status)) {
      return res.status(400).json({ success: false, message: '상태값 오류' });
    }
    await pool.query('UPDATE consulting_request SET status=$1 WHERE id=$2', [status, id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false });
  }
});

// ── 어드민: 가입 회원 + 단계 진행 현황 (STEP1~7 퍼널 추적, 과금 근거) ──
app.get('/api/admin/members', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.name, u.phone, u.created_at,
        cp.biz_name, cp.segments, cp.industry_code, cp.region_sido,
        (cp.id IS NOT NULL) AS s_profile,
        EXISTS(SELECT 1 FROM item_overview io WHERE io.profile_id = cp.id) AS s_item,
        EXISTS(SELECT 1 FROM accelerator_analysis aa WHERE aa.profile_id = cp.id) AS s_analysis,
        EXISTS(SELECT 1 FROM business_plan bp JOIN application a ON a.id = bp.application_id WHERE a.user_id = u.id) AS s_plan,
        EXISTS(SELECT 1 FROM pitch_deck pd JOIN business_plan bp ON bp.id = pd.plan_id JOIN application a ON a.id = bp.application_id WHERE a.user_id = u.id) AS s_deck,
        EXISTS(SELECT 1 FROM consulting_request cr WHERE cr.user_id = u.id) AS s_consulting
      FROM users u
      LEFT JOIN customer_profile cp ON cp.user_id = u.id
      WHERE u.role = 'member' OR u.role IS NULL
      ORDER BY u.created_at DESC
    `);
    res.json({ data: rows });
  } catch (err) {
    console.error('members error:', err.message);
    res.status(500).json({ error: '회원 목록 조회 실패' });
  }
});

// ═══════════════════════════════════════════════════════
//  DB 확인 후 서버 시작
// ═══════════════════════════════════════════════════════
async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('✅ DB 연결 성공 (스키마는 `npm run migrate` 로 관리)');
  } catch (err) {
    console.warn('⚠️  DB 연결 실패 (DB 없이 시작):', err.message);
  }

  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(`\n🚀 서버 실행 중: http://localhost:${PORT}`);
    console.log(`📋 어드민 패널: http://localhost:${PORT}/admin\n`);
  });
}

start();
