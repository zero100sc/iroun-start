require('dotenv').config();
const express  = require('express');
const { Pool } = require('pg');
const session  = require('express-session');
const path     = require('path');
const fs       = require('fs');

const app  = express();
app.set('trust proxy', 1); // Cloud Run이 HTTPS를 종료하므로 secure 쿠키 인식을 위해 필요
// Cloud SQL 소켓(/cloudsql/)이나 로컬 연결은 SSL 불필요, 그 외 원격 DB(Supabase 등)는 SSL 적용
const dbUrl = process.env.DATABASE_URL || '';
const useSSL = !dbUrl.includes('/cloudsql/')
  && !dbUrl.includes('localhost')
  && !dbUrl.includes('127.0.0.1');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

// ── 미들웨어 ───────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
  },
}));

// 파비콘 (404 방지)
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ── 어드민 인증 미들웨어 ───────────────────────────────
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

// ═══════════════════════════════════════════════════════
//  공개 API
// ═══════════════════════════════════════════════════════

// 폼 제출
app.post('/api/submit', async (req, res) => {
  try {
    const {
      type, name, phone,
      currentStatus, businessType,       // 예비창업자
      businessName, industry,            // 소상공인
      operationPeriod, employeeCount,
      interests, message,
    } = req.body;

    if (!type || !name || !phone) {
      return res.status(400).json({ success: false, message: '필수 항목을 입력해주세요.' });
    }

    const interestsArr = Array.isArray(interests)
      ? interests
      : interests ? [interests] : [];

    const { rows } = await pool.query(
      `INSERT INTO submissions
         (type, name, phone, current_status, business_type,
          business_name, industry, operation_period, employee_count, interests, message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [type, name, phone,
       currentStatus || null, businessType || null,
       businessName || null, industry || null,
       operationPeriod || null, employeeCount || null,
       interestsArr, message || null],
    );

    res.json({ success: true, id: rows[0].id });
  } catch (err) {
    console.error('submit error:', err.message);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// ═══════════════════════════════════════════════════════
//  어드민 인증
// ═══════════════════════════════════════════════════════

app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === (process.env.ADMIN_PASSWORD || 'iroun2025!')) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.redirect('/admin/login?error=1');
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
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

// 통계
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

// 목록 조회
app.get('/api/admin/submissions', requireAdmin, async (req, res) => {
  try {
    const { type, status, q, page = 1 } = req.query;
    const limit  = 20;
    const offset = (Math.max(1, parseInt(page)) - 1) * limit;

    const conditions = ['1=1'];
    const params     = [];

    if (type)   { params.push(type);   conditions.push(`type = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
    if (q) {
      params.push(`%${q}%`);
      conditions.push(`(name ILIKE $${params.length} OR phone ILIKE $${params.length} OR business_name ILIKE $${params.length})`);
    }

    const where = conditions.join(' AND ');

    const [dataRes, countRes] = await Promise.all([
      pool.query(
        `SELECT * FROM submissions WHERE ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
      pool.query(`SELECT COUNT(*) FROM submissions WHERE ${where}`, params),
    ]);

    res.json({
      data:  dataRes.rows,
      total: parseInt(countRes.rows[0].count),
      page:  parseInt(page),
      limit,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: '목록 조회 실패' });
  }
});

// 상태 변경 + 메모 저장
app.patch('/api/admin/submissions/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, memo } = req.body;

    const sets  = [];
    const vals  = [];

    if (status !== undefined) { vals.push(status); sets.push(`status=$${vals.length}`); }
    if (memo   !== undefined) { vals.push(memo);   sets.push(`memo=$${vals.length}`); }
    vals.push(id);
    sets.push(`updated_at=NOW()`);

    await pool.query(
      `UPDATE submissions SET ${sets.join(',')} WHERE id=$${vals.length}`,
      vals,
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false });
  }
});

// CSV 내보내기
app.get('/api/admin/export', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM submissions ORDER BY created_at DESC');

    const header = ['ID','유형','이름','연락처','현재상태','예정업종','상호명','업종','사업기간','직원수','관심사업','문의내용','어드민메모','상담상태','접수일'];
    const csvRows = rows.map(r => [
      r.id, r.type, r.name, r.phone,
      r.current_status || '', r.business_type || '',
      r.business_name  || '', r.industry      || '',
      r.operation_period || '', r.employee_count || '',
      (r.interests || []).join(' | '),
      r.message || '', r.memo || '', r.status,
      new Date(r.created_at).toLocaleString('ko-KR'),
    ]);

    const csv = [header, ...csvRows]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="submissions_${Date.now()}.csv"`);
    res.send('﻿' + csv); // BOM for Excel
  } catch (err) {
    console.error(err.message);
    res.status(500).send('내보내기 실패');
  }
});

// ═══════════════════════════════════════════════════════
//  DB 초기화 확인 후 서버 시작
// ═══════════════════════════════════════════════════════
async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('✅ DB 연결 성공');

    // 테이블 없으면 자동 생성
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('✅ 스키마 준비 완료');
  } catch (err) {
    console.warn('⚠️  DB 연결 실패 (DB 없이 시작):', err.message);
  }

  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(`\n🚀 서버 실행 중: http://localhost:${PORT}`);
    console.log(`📋 어드민 패널: http://localhost:${PORT}/admin`);
    console.log(`🔑 어드민 비밀번호: ${process.env.ADMIN_PASSWORD || 'iroun2025!'}\n`);
  });
}

start();
