/**
 * 검색 회귀 테스트.
 *
 *   npm run search:test
 *
 * 기획서 7장 'P0-6. 이번 6개 질의를 회귀 테스트에 등록합니다' 를 우리 코퍼스에 맞게 옮긴 것이다.
 * 기획서의 예시어(이끼·효소·미네랄·분뇨)는 우리 DB 에 0건이라 그대로 쓸 수 없어,
 * 같은 **실패 유형**을 우리 데이터에 실제로 존재하는 어휘로 재현했다.
 *
 * 사전(dictionary.js)이나 랭킹(rank.js)을 고치면 반드시 이걸 돌린다.
 * 검색 품질은 눈으로 몇 건 보고 판단하면 반드시 퇴행한다.
 */
require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { searchPrograms } = require('../src/search');
const { planQuery } = require('../src/search/query-plan');

const dbUrl = process.env.DATABASE_URL || '';
if (!dbUrl) {
  console.error('❌ DATABASE_URL 이 없습니다.');
  process.exit(1);
}
const useSSL = !dbUrl.includes('/cloudsql/') && !dbUrl.includes('localhost') && !dbUrl.includes('127.0.0.1');
const pool = new Pool({ connectionString: dbUrl, ssl: useSSL ? { rejectUnauthorized: false } : false });

const hay = (it) => [it.name, it.summary, it.field, it.agency,
                     (it.normalized_tags || []).join(' ')].join(' ').toLowerCase();

/**
 * 각 항목: { name, q, check(result, plan) → true 또는 실패사유 문자열 }
 */
const CASES = [
  {
    // 원어('인공지능')가 동의어('AI')보다 점수가 높으므로 1페이지는 원어 문서로 채워진다.
    // 그래서 '앞쪽에 AI 문서가 있는가' 로 보면 안 되고, 원어 단독 건수와 총계를 견줘야 한다.
    name: '동의어 확장 — 인공지능으로 검색해도 AI 공고가 잡힌다',
    q: '인공지능',
    check: async (r, { pool, search }) => {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM gov_program
          WHERE name ILIKE '%인공지능%' OR COALESCE(summary,'') ILIKE '%인공지능%'
             OR COALESCE(field,'') ILIKE '%인공지능%'`);
      const bare = rows[0].n;
      if (r.total < bare * 2) return `총 ${r.total}건 vs 원어 단독 ${bare}건 — 동의어 확장 효과가 없다`;

      // 뒤쪽 페이지까지 가면 'AI' 만 든 공고가 실제로 나와야 한다.
      const deep = await search({ q: '인공지능', page: Math.ceil(r.total / 20), pageSize: 20 });
      const aiOnly = deep.items.some((it) =>
        !hay(it).includes('인공지능') && /(^|[^a-z0-9])ai([^a-z0-9]|$)/.test(hay(it)));
      return aiOnly || 'AI 만 들어있는 공고를 끝까지 뒤져도 찾지 못했다';
    },
  },
  {
    name: '일반어 배제 — 지원 은 검색어에서 빠진다',
    q: '청년 창업 지원',
    check: (r) => {
      if (!r.ignoredTerms.includes('지원')) return `'지원' 이 무시어로 분류되지 않았다: ${JSON.stringify(r.ignoredTerms)}`;
      if (!r.coreTerms.some((c) => c.term === '청년')) return '청년 이 핵심어로 잡히지 않았다';
      return true;
    },
  },
  {
    name: '일반어 단독 — 결과를 만들되 참고 등급으로만 표시한다',
    q: '지원',
    check: (r) => {
      if (r.coreTerms.length) return '일반어만 쳤는데 핵심어가 생겼다';
      const bad = r.items.find((it) => it.match && it.match.tier !== 'weak');
      return !bad || `참고 등급이 아닌 결과가 섞였다: ${bad.name}`;
    },
  },
  {
    name: '개념그룹 AND — 두 개념이 모두 있는 공고만 정확 일치가 된다',
    q: '수출 바우처',
    check: (r) => {
      const strict = r.items.filter((it) => ['exact', 'synonym'].includes(it.match.tier));
      const bad = strict.find((it) => it.match.missingTerms.length);
      return !bad || `정확/동의어 등급인데 누락 개념이 있다: ${bad.name} (${bad.match.missingTerms})`;
    },
  },
  {
    name: '정확구문 — 큰따옴표는 원문 그대로 들어있는 공고만',
    q: '"창업보육센터"',
    check: (r) => {
      if (!r.phrases.includes('창업보육센터')) return '구문이 인식되지 않았다';
      if (!r.total) return '구문 검색 결과가 0건';
      const bad = r.items.find((it) => !hay(it).includes('창업보육센터'));
      return !bad || `구문이 없는 공고가 섞였다: ${bad.name}`;
    },
  },
  {
    name: '오타 교정 — 미네럴을 미네랄로 고쳐 검색한다',
    q: '미네럴을 이용한 축산',
    check: (r) => {
      if (!r.corrections.some((c) => c.from === '미네럴' && c.to === '미네랄')) return '오타 교정이 기록되지 않았다';
      if (!r.coreTerms.some((c) => c.term === '축산')) return '조사(을) 제거 후 축산 이 핵심어로 남지 않았다';
      if (!r.ignoredTerms.includes('이용')) return "'이용한' 이 일반어로 처리되지 않았다";
      return true;
    },
  },
  {
    name: '완화검색 — 한쪽 개념이 0건이면 부족을 알리고 일부 일치를 보여준다',
    q: '미네럴을 이용한 축산',
    check: (r) => {
      if (!r.relaxed) return '엄격 결과가 0건인데 완화검색이 켜지지 않았다';
      const bad = r.items.find((it) => it.match.tier === 'exact');
      return !bad || `일치하지 않는데 정확 일치로 표시됐다: ${bad.name}`;
    },
  },
  {
    name: '약어 경계 — IP 검색이 Membership·TIPS 를 끌어오지 않는다',
    q: '특허',
    check: (r) => {
      const bad = r.items.find((it) => {
        const h = hay(it);
        const hasReal = ['특허', '지식재산', '상표', '실용신안', '디자인권'].some((t) => h.includes(t))
          || /(^|[^a-z0-9])ip([^a-z0-9]|$)/.test(h);
        return !hasReal;
      });
      return !bad || `지식재산 개념이 없는 공고가 걸렸다: ${bad.name}`;
    },
  },
  {
    name: '복합명사 — 붙여 쓴 창업보육 이 띄어 쓴 원문도 잡는다',
    q: '창업보육',
    check: (r) => (r.total > 100 ? true : `총 ${r.total}건 — 구성명사 분해가 동작하지 않는 듯`),
  },
  {
    // 이 테스트의 앞선 판본은 '시설 공간'(이미 띄어 쓴 말)으로 검색해서 ㆍ 경로를 아예
    // 타지 않았다. 기능이 완전히 망가진 상태에서도 통과하는 가짜 테스트였다.
    // 반드시 ㆍ(U+318D) 를 직접 입력해야 한다.
    name: '가운뎃점 정규화 — 사용자가 ㆍ 를 그대로 쳐도 검색된다',
    q: '시설ㆍ공간',
    check: (r) => {
      if (r.normalizedQuery.indexOf('ㆍ') !== -1 || r.normalizedQuery.indexOf('ᆞ') !== -1) {
        return `정규화 후에도 가운뎃점이 남아 있다: ${JSON.stringify(r.normalizedQuery)}`;
      }
      if (!r.coreTerms.some((c) => c.term === '시설') || !r.coreTerms.some((c) => c.term === '공간')) {
        return `핵심어가 둘로 갈라지지 않았다: ${JSON.stringify(r.coreTerms.map((c) => c.term))}`;
      }
      return r.total > 0 || '결과가 0건';
    },
  },
  {
    name: '구두점만 입력 — 전체 목록을 검색 결과로 위장하지 않는다',
    q: '·',
    check: (r) => {
      const bad = r.items.find((it) => it.match && it.match.tier !== 'weak');
      if (bad) return `등급이 붙은 결과가 나왔다: ${bad.name}`;
      if (r.coreTerms.length) return '구두점에서 핵심어가 생겼다';
      return true;
    },
  },
  {
    name: '조사 절단 보험 — 전문가 로 검색해도 전문가 공고가 잡힌다',
    q: '전문가',
    check: async (r, { pool }) => {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM gov_program WHERE search_blob ILIKE '%전문가%'`);
      if (!rows[0].n) return true;   // 코퍼스에 없으면 검사 불가
      if (!r.total) return `원문에 전문가 공고가 ${rows[0].n}건 있는데 검색 결과가 0건`;
      const hit = r.items.some((it) => hay(it).includes('전문가'));
      return hit || '전문가 가 실제로 든 공고가 결과에 없다 — 어간만 검색된 듯';
    },
  },
  {
    name: '지역 필터 — 시도를 골라도 전국 공고가 함께 나온다',
    q: '창업',
    check: async (r, { search, pool }) => {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM gov_program WHERE region = '전국' AND search_blob ILIKE '%창업%'`);
      if (!rows[0].n) return true;
      const seoul = await search({ q: '창업', region: '서울', pageSize: 50 });
      const hasNational = seoul.items.some((it) => it.region === '전국');
      return hasNational || '서울로 좁혔더니 전국 공고가 하나도 안 나온다';
    },
  },
  {
    name: '단일 개념 질의 — 불필요한 완화검색을 돌리지 않는다',
    q: '반도체',
    check: (r) => (r.relaxed ? '개념이 하나뿐인데 완화검색이 켜졌다(엄격과 동일 조건)' : true),
  },
  {
    name: '빈 검색어 — 목록 열람으로 떨어지고 오류가 없다',
    q: '',
    check: (r) => (r.items.length > 0 ? true : '빈 검색어에서 결과가 비었다'),
  },
  {
    // 실제로 터졌던 버그: 결과 범위를 넘는 페이지를 요청하면 폴백 COUNT 질의에
    // LIMIT/OFFSET 파라미터까지 넘어가 "bind message supplies 10 parameters" 로 500 이 났다.
    name: '범위 밖 페이지 — 빈 결과를 정상 반환한다(500 이 아니라)',
    q: '창업',
    check: async (r, { search }) => {
      const far = await search({ q: '창업', page: 400, pageSize: 20 });
      if (far.items.length !== 0) return `범위 밖인데 ${far.items.length}건이 왔다`;
      if (far.total !== r.total) return `총계가 페이지마다 다르다: ${r.total} vs ${far.total}`;
      return true;
    },
  },
];

(async () => {
  let pass = 0;
  const failures = [];

  console.log('━━━ 검색 회귀 테스트 ━━━\n');
  for (const c of CASES) {
    let verdict;
    try {
      const r = await searchPrograms(pool, { q: c.q, pageSize: 20 });
      verdict = await c.check(r, {
        plan: planQuery(c.q),
        pool,
        search: (opts) => searchPrograms(pool, opts),
      });
    } catch (err) {
      verdict = `예외 발생: ${err.message}`;
    }
    if (verdict === true) {
      pass++;
      console.log(`  ✅ ${c.name}`);
    } else {
      failures.push({ ...c, verdict });
      console.log(`  ❌ ${c.name}`);
      console.log(`      질의: "${c.q}"`);
      console.log(`      사유: ${verdict}`);
    }
  }

  console.log(`\n${pass}/${CASES.length} 통과`);
  await pool.end();
  if (failures.length) process.exitCode = 1;
})();
