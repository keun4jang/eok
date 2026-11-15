'use strict';

/* ===================== 데이터 ===================== */
const APP_VERSION = 'v11 · 2026-11-15'; // 앱을 고칠 때마다 sw.js의 CACHE와 함께 올릴 것
const STORAGE_KEY = 'moneyplan.v1'; // 앱 이름이 '억'으로 바뀌었지만 기존 데이터 호환을 위해 키 유지
const EXPENSE_CATS = ['식비', '카페/간식', '교통', '쇼핑', '생활용품', '주거/관리비', '통신', '구독', '보험', '문화/여가', '의료', '교육', '경조사', '대출이자', '기타'];
const INCOME_CATS = ['급여', '부수입', '상여', '이자/배당', '용돈', '기타'];
// 줄이기 쉬운(재량) 지출 카테고리 — 목표 달성 부족분을 여기서 우선 깎는다
const DISCRETIONARY = ['카페/간식', '쇼핑', '문화/여가', '식비', '생활용품', '기타'];

// 카테고리 색: 채도를 낮춘 톤으로 통일 (골드·세이지·슬레이트·모브 계열)
const CAT_COLORS = {
  '식비': '#C8A96A', '카페/간식': '#B88A6A', '교통': '#7F93B5', '쇼핑': '#A88BA8', '생활용품': '#8FB8A0',
  '주거/관리비': '#6F8FA3', '통신': '#9AA6B8', '구독': '#C48E9A', '보험': '#8C9C7A', '문화/여가': '#D1B98A',
  '의료': '#7FA8A4', '교육': '#9C8FC4', '경조사': '#C9876F', '대출이자': '#A0705F', '기타': '#8A8F98',
  '급여': '#8FB8A0', '부수입': '#A3C2AE', '상여': '#C8A96A', '이자/배당': '#7FA8A4', '용돈': '#B5A3C4',
};
const catColor = c => CAT_COLORS[c] || '#8A8F98';
const catIcon = (c, type) => `<span class="cat-ic" style="--c:${catColor(c)}">${esc(String(c).charAt(0))}</span>`;

const defaultState = () => ({
  tx: [],      // {id, type:'income'|'expense', amount, category, memo, date:'YYYY-MM-DD'}
  fixed: [],   // {id, type, name, amount, category, day}
  goals: [],   // {id, name, target, saved, deadline:'YYYY-MM', rate}
  settings: { emergency: 0, highDebt: false },
  merchantCats: {}, // 가맹점 → 사용자가 고른 카테고리 (문자 입력 시 학습)
});

let state = load();
let snap = SyncCore.snapshot(state); // 마지막 저장 시점 스냅샷 — 저장할 때 바뀐 레코드에 수정 시각(u)을 찍는 데 사용
let currentTab = 'home';
let viewMonth = ym(new Date());
let txMode = 'list';      // 'list' | 'cal'
let selectedDay = null;   // 달력에서 선택한 날짜

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    return { ...defaultState(), ...s, settings: { ...defaultState().settings, ...(s.settings || {}) } };
  } catch (e) {
    console.warn('load failed', e);
    return defaultState();
  }
}
function save() {
  snap = SyncCore.stamp(state, snap);
  persist();
  window.EokSync?.schedule(); // 로그인돼 있으면 잠시 뒤 클라우드와 동기화
}
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { alert('저장에 실패했습니다: ' + e.message); }
}
// 동기화로 합쳐진 상태를 받아들일 때(수정 시각을 다시 찍지 않음)
function adopt(next) {
  state = { ...defaultState(), ...next, settings: { ...defaultState().settings, ...(next.settings || {}) } };
  snap = SyncCore.snapshot(state);
  persist();
  if (!sheet.open) render();
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ===================== 유틸 ===================== */
function ym(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number);
  return ym(new Date(y, mo - 1 + delta, 1));
}
function monthDiff(from, to) {
  const [y1, m1] = from.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}
const won = n => (Math.round(n) || 0).toLocaleString('ko-KR') + '원';
function shortWon(n) {
  const a = Math.abs(n), sign = n < 0 ? '-' : '';
  if (a >= 1e8) return sign + (a / 1e8).toFixed(a >= 1e9 ? 0 : 1).replace(/\.0$/, '') + '억';
  if (a >= 1e4) return sign + Math.round(a / 1e4).toLocaleString('ko-KR') + '만';
  return sign + Math.round(a).toLocaleString('ko-KR');
}
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayStr = () => { const d = new Date(); return `${ym(d)}-${String(d.getDate()).padStart(2, '0')}`; };
const parseAmount = v => Math.max(0, Number(String(v).replace(/[^\d.]/g, '')) || 0);
const monthLabel = m => { const [y, mo] = m.split('-'); return `${y}년 ${Number(mo)}월`; };

/* ===================== 계산 ===================== */
function monthStats(m) {
  const txs = state.tx.filter(t => t.date.startsWith(m));
  const varIncome = sum(txs.filter(t => t.type === 'income'));
  const varExpense = sum(txs.filter(t => t.type === 'expense'));
  const fx = activeFixed(m);
  const fixedIncome = sum(fx.filter(f => f.type === 'income'));
  const fixedExpense = sum(fx.filter(f => f.type === 'expense'));
  const byCat = {};
  txs.filter(t => t.type === 'expense').forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
  const income = varIncome + fixedIncome;
  const expense = varExpense + fixedExpense;
  return { m, txs, income, expense, varIncome, varExpense, fixedIncome, fixedExpense, byCat, net: income - expense, txCount: txs.length };
}
function sum(arr) { return arr.reduce((a, b) => a + (Number(b.amount) || 0), 0); }

// 평균 계산: 지난 3개월(완료된 달) 중 기록이 있는 달을 우선 사용.
// 이번 달은 진행 중이라 지출이 덜 잡혀 여유자금이 부풀려지므로, 완료된 달 기록이 없을 때만 사용한다.
function avgStats(now = ym(new Date())) {
  const past = [1, 2, 3].map(i => monthStats(shiftMonth(now, -i))).filter(s => s.txCount > 0);
  const partial = past.length === 0;
  const use = partial ? [monthStats(now)] : past;
  const n = use.length;
  const byCat = {};
  use.forEach(s => Object.entries(s.byCat).forEach(([k, v]) => { byCat[k] = (byCat[k] || 0) + v / n; }));
  const avg = key => use.reduce((a, s) => a + s[key], 0) / n;
  return {
    months: n, partial, income: avg('income'), expense: avg('expense'), varExpense: avg('varExpense'),
    fixedExpense: avg('fixedExpense'), net: avg('net'), byCat, hasData: use.some(s => s.txCount > 0),
  };
}
const basisText = avg => avg.partial
  ? '이번 달(진행 중) 기록 기준 — 월말 전이라 지출이 덜 잡혀 실제보다 낙관적일 수 있어요'
  : `지난 ${avg.months}개월 평균 기준`;

// 목표 달성에 필요한 월 적립액 (월복리, 월말 적립 가정)
function requiredMonthly(target, saved, months, annualRate) {
  const r = annualRate / 100 / 12;
  if (months <= 0) return Math.max(0, target - saved);
  if (r === 0) return Math.max(0, (target - saved) / months);
  const fvSaved = saved * Math.pow(1 + r, months);
  const remain = target - fvSaved;
  if (remain <= 0) return 0;
  return remain * r / (Math.pow(1 + r, months) - 1);
}
// 월 적립액 pmt로 몇 달 걸리는지 (최대 100년)
function monthsToReach(target, saved, pmt, annualRate) {
  const r = annualRate / 100 / 12;
  let bal = saved;
  for (let i = 0; i <= 1200; i++) {
    if (bal >= target) return i;
    bal = bal * (1 + r) + pmt;
  }
  return Infinity;
}

function goalPlan(g, avg) {
  const now = ym(new Date());
  const months = Math.max(1, monthDiff(now, g.deadline));
  const need = requiredMonthly(g.target, g.saved, months, g.rate);
  // 여러 목표가 있으면 월 여유자금을 목표 금액 비율이 아니라 "필요 적립액" 비율로 나눠 배분
  const totalNeed = state.goals.reduce((a, x) => a + requiredMonthly(x.target, x.saved, Math.max(1, monthDiff(now, x.deadline)), x.rate), 0);
  const surplus = Math.max(0, avg.net);
  const share = totalNeed > 0 ? surplus * (need / totalNeed) : surplus;
  const shortfall = Math.max(0, need - share);
  const etaMonths = monthsToReach(g.target, g.saved, share, g.rate);

  // 부족분을 재량 지출에서 최대 30%씩 줄여 메우는 제안
  const cuts = [];
  let left = shortfall;
  const cands = DISCRETIONARY
    .map(c => ({ c, v: avg.byCat[c] || 0 }))
    .filter(x => x.v > 0)
    .sort((a, b) => b.v - a.v);
  for (const { c, v } of cands) {
    if (left <= 0) break;
    const cut = Math.min(v * 0.3, left);
    cuts.push({ category: c, current: v, cut });
    left -= cut;
  }
  const cutsCover = shortfall > 0 && left <= 1;
  const progress = pct(g.saved, g.target);
  return { months, need, share, shortfall, etaMonths, cuts, cutsCover, remainingAfterCuts: Math.max(0, left), progress };
}

/* ===================== 렌더링 ===================== */
const $ = s => document.querySelector(s);
const view = $('#view');

function render() {
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === currentTab));
  $('#monthLabel').textContent = monthLabel(viewMonth);
  $('#monthPicker').style.visibility = (currentTab === 'home' || currentTab === 'tx') ? 'visible' : 'hidden';
  $('#fab').style.display = (currentTab === 'home' || currentTab === 'tx') ? '' : 'none';
  ({ home: renderHome, tx: renderTx, fixed: renderFixed, goals: renderGoals, insights: renderInsights })[currentTab]();
}

function renderHome() {
  const s = monthStats(viewMonth);
  const rate = s.income > 0 ? Math.round((s.net / s.income) * 100) : 0;
  const cats = Object.entries(s.byCat).sort((a, b) => b[1] - a[1]);
  const recent = [...s.txs].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 5);
  const spentPct = s.income > 0 ? Math.min(100, pct(s.expense, s.income)) : 0;

  view.innerHTML = `
    <section class="hero">
      <div class="hero-label">${monthLabel(viewMonth)} 남은 돈</div>
      <div class="hero-amount ${s.net < 0 ? 'neg' : ''}">${won(s.net)}</div>
      <div class="hero-bar"><i style="width:${spentPct}%"></i></div>
      <div class="hero-meta"><span>수입의 ${s.income > 0 ? pct(s.expense, s.income) : 0}% 지출</span><span>저축률 ${s.income > 0 ? rate + '%' : '–'}</span></div>
      <div class="hero-split">
        <div><span>수입</span><b>${won(s.income)}</b></div>
        <div><span>지출</span><b>${won(s.expense)}</b></div>
      </div>
    </section>

    <section class="card grid2 compact">
      <div class="stat"><div class="label">고정지출</div><div class="value">${won(s.fixedExpense)}</div></div>
      <div class="stat"><div class="label">변동지출</div><div class="value">${won(s.varExpense)}</div></div>
    </section>

    <section class="card">
      <h2>지출 구성</h2>
      ${cats.length ? `
        <div class="donut-wrap">
          ${donut(cats, s.varExpense)}
          <div class="donut-center"><span>변동지출</span><b>${shortWon(s.varExpense)}원</b></div>
        </div>
        <ul class="list cats">${cats.map(([c, v]) => `
          <li><div class="li-main">${catIcon(c)}<div><div class="title">${esc(c)}</div><div class="sub">${v / s.varExpense < 0.01 ? '1% 미만' : pct(v, s.varExpense) + '%'}</div></div></div>
          <div class="amount">${won(v)}</div></li>`).join('')}</ul>`
        : `<div class="empty">아직 지출 기록이 없어요<br><span>오른쪽 아래 ＋ 버튼으로 시작하세요</span></div>`}
    </section>

    <section class="card">
      <div class="row"><h2>최근 내역</h2>${s.txs.length ? `<button class="link-btn" data-goto="tx">전체 보기 ›</button>` : ''}</div>
      ${recent.length ? `<ul class="list">${recent.map(txItem).join('')}</ul>` : `<div class="empty">기록 없음</div>`}
    </section>
    ${state.goals.length ? renderGoalSummary() : ''}
  `;
}

function donut(cats, total) {
  const R = 52, C = 2 * Math.PI * R;
  let off = 0;
  const arcs = cats.map(([c, v]) => {
    const len = total > 0 ? (v / total) * C : 0;
    const gap = cats.length > 1 ? Math.min(2, len / 3) : 0;
    const el = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${catColor(c)}" stroke-width="14"
      stroke-dasharray="${Math.max(0, len - gap)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"/>`;
    off += len;
    return el;
  }).join('');
  return `<svg class="donut" viewBox="0 0 140 140" aria-hidden="true"><circle r="${R}" cx="70" cy="70" fill="none" stroke="var(--line)" stroke-width="14"/>${arcs}</svg>`;
}

function renderGoalSummary() {
  const avg = avgStats();
  return `<section class="card"><div class="row"><h2>목표</h2><button class="link-btn" data-goto="goals">자세히 ›</button></div>
    ${state.goals.map(g => { const p = goalPlan(g, avg); return `
      <div class="cat-row">
        <div class="row"><span class="title">${esc(g.name)}</span><span class="muted">${p.progress}% · 월 ${shortWon(p.need)}원</span></div>
        <div class="bar ${p.shortfall > 0 ? 'over' : ''}"><i style="width:${Math.min(100, p.progress)}%"></i></div>
      </div>`; }).join('')}
  </section>`;
}

function txItem(t) {
  return `<li data-edit-tx="${t.id}">
    <div class="li-main">${catIcon(t.category, t.type)}<div><div class="title">${esc(t.memo || t.category)}</div><div class="sub">${esc(t.category)} · ${Number(t.date.slice(8))}일${t.auto ? ' · <span class="pill">자동</span>' : ''}</div></div></div>
    <div class="amount ${t.type}">${t.type === 'income' ? '+' : '−'}${won(t.amount)}</div>
  </li>`;
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
function renderTx() {
  const s = monthStats(viewMonth);
  const list = [...s.txs]
    .filter(t => !selectedDay || t.date === selectedDay)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const groups = {};
  list.forEach(t => (groups[t.date] = groups[t.date] || []).push(t));
  const dayLabel = d => { const dt = new Date(d + 'T00:00'); return `${dt.getMonth() + 1}월 ${dt.getDate()}일 ${WEEK[dt.getDay()]}요일`; };
  const dayTotal = ts => { const e = sum(ts.filter(t => t.type === 'expense')), i = sum(ts.filter(t => t.type === 'income'));
    return `${i ? `<span class="income">+${won(i)}</span> ` : ''}${e ? `<span>−${won(e)}</span>` : ''}`; };

  view.innerHTML = `
    <div class="seg view-seg">
      <input type="radio" name="txmode" id="mList" value="list" ${txMode === 'list' ? 'checked' : ''}><label for="mList">목록</label>
      <input type="radio" name="txmode" id="mCal" value="cal" ${txMode === 'cal' ? 'checked' : ''}><label for="mCal">달력</label>
    </div>
    <button class="sms-cta" data-sms>
      <span class="cat-ic" style="--c:var(--gold)">✉</span>
      <span><b>문자·카톡으로 한 번에 입력</b><small>결제 알림을 복사해서 붙여넣기</small></span><span class="chev">›</span>
    </button>
    <section class="card grid2 compact">
      <div class="stat"><div class="label">기록된 수입</div><div class="value income">${won(s.varIncome)}</div></div>
      <div class="stat"><div class="label">기록된 지출</div><div class="value expense">${won(s.varExpense)}</div></div>
    </section>
    ${txMode === 'cal' ? calendar(s) : ''}
    ${selectedDay ? `<div class="row filter-chip"><span>선택한 날짜만 보는 중</span><button class="link-btn" data-clear-day>전체 보기 ✕</button></div>` : ''}
    ${list.length ? Object.entries(groups).map(([d, ts]) => `
      <section class="card">
        <div class="row day-head"><span>${dayLabel(d)}</span><span class="amount">${dayTotal(ts)}</span></div>
        <ul class="list">${ts.map(txItem).join('')}</ul>
      </section>`).join('') : `<section class="card"><div class="empty">${selectedDay ? '이 날' : monthLabel(viewMonth)} 기록이 없어요</div></section>`}
    <p class="muted foot">고정 수입·지출은 '고정' 탭에서 관리하며 매달 자동 합산됩니다.</p>
  `;
}

function calendar(s) {
  const [y, m] = viewMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const exp = {}, inc = {};
  s.txs.forEach(t => { const o = t.type === 'expense' ? exp : inc; o[t.date] = (o[t.date] || 0) + t.amount; });
  const today = todayStr();
  let cells = '';
  for (let i = 0; i < first; i++) cells += '<div></div>';
  for (let d = 1; d <= days; d++) {
    const ds = `${viewMonth}-${String(d).padStart(2, '0')}`;
    const dow = (first + d - 1) % 7;
    cells += `<button class="cal-day ${ds === today ? 'today' : ''} ${ds === selectedDay ? 'sel' : ''} ${dow === 0 ? 'sun' : ''}" data-day="${ds}">
      <span class="d">${d}</span>
      ${inc[ds] ? `<span class="ci">+${shortWon(inc[ds])}</span>` : ''}
      ${exp[ds] ? `<span class="ce">${shortWon(exp[ds])}</span>` : ''}
    </button>`;
  }
  return `<section class="card cal">
    <div class="cal-grid cal-head">${WEEK.map(w => `<div>${w}</div>`).join('')}</div>
    <div class="cal-grid">${cells}</div>
  </section>`;
}

function renderFixed() {
  const now = ym(new Date());
  const active = activeFixed(now);
  const inc = active.filter(f => f.type === 'income');
  const exp = active.filter(f => f.type === 'expense' && !f.until).sort((a, b) => b.amount - a.amount);
  const inst = active.filter(f => f.type === 'expense' && f.until).sort((a, b) => a.until.localeCompare(b.until));
  const ended = state.fixed.filter(f => f.until && f.until < now);
  const expTotal = sum(exp) + sum(inst), incTotal = sum(inc);
  const endingSoon = sum(inst.filter(f => f.until === now));
  const item = f => `<li data-edit-fixed="${f.id}">
      <div class="li-main">${catIcon(f.category)}<div><div class="title">${esc(f.name)}</div><div class="sub">${esc(f.category)}${f.day ? ` · 매월 ${f.day}일` : ''}${f.until ? ` · ${untilLabel(f.until, now)}` : ''}</div></div></div>
      <div class="amount ${f.type}">${won(f.amount)}</div></li>`;
  view.innerHTML = `
    <section class="card">
      <div class="muted">이번 달 고정지출 합계</div>
      <div class="big expense">${won(expTotal)}</div>
      <div class="muted">${incTotal ? `고정수입 ${won(incTotal)}의 ${pct(expTotal, incTotal)}%` : '고정수입 미등록'}${inst.length ? ` · 할부 ${won(sum(inst))} 포함` : ''}</div>
      ${endingSoon ? `<div class="muted">이번 달로 끝나는 할부 ${won(endingSoon)} → 다음 달부터 그만큼 여유</div>` : ''}
    </section>
    <button class="sms-cta" data-import-fixed>
      <span class="cat-ic" style="--c:var(--gold)">⇣</span>
      <span><b>목록 붙여넣어 한 번에 등록</b><small>카드사·은행 분석 결과, 표, 메모 등</small></span><span class="chev">›</span>
    </button>
    <section class="card">
      <div class="row"><h2>고정수입</h2><button class="btn sm ghost" data-add-fixed="income">＋ 추가</button></div>
      ${inc.length ? `<ul class="list">${inc.map(item).join('')}</ul>` : `<div class="empty">월급처럼 매달 들어오는 돈을 등록하세요.</div>`}
    </section>
    <section class="card">
      <div class="row"><h2>고정지출</h2><button class="btn sm ghost" data-add-fixed="expense">＋ 추가</button></div>
      ${exp.length ? `<ul class="list">${exp.map(item).join('')}</ul>` : `<div class="empty">월세, 통신비, 보험, 구독, 대출이자 등을 등록하세요.</div>`}
    </section>
    ${inst.length ? `<section class="card"><h2>할부 <span class="muted">· 종료 월이 지나면 자동으로 빠져요</span></h2><ul class="list">${inst.map(item).join('')}</ul></section>` : ''}
    ${ended.length ? `<section class="card"><div class="row"><h2 class="muted">끝난 할부 ${ended.length}건</h2><button class="link-btn" data-clear-ended>정리하기</button></div></section>` : ''}
  `;
}
const activeFixed = m => state.fixed.filter(f => !f.until || m <= f.until);
function untilLabel(until, now) {
  const left = monthDiff(now, until) + 1;
  return `${until.replace('-', '.')}까지 (${left}회 남음)`;
}

/* ===================== 고정 항목 일괄 등록 ===================== */
let fixedItems = [];
const KIND_LABEL = { income: '수입', expense: '지출', installment: '할부', saving: '저축/이동', card: '카드대금' };

function openFixedImportSheet() {
  fixedItems = [];
  openSheet(`<h2>고정 항목 한 번에 등록</h2>
    <p class="muted" style="margin:-8px 0 10px">카드사·은행 분석 결과나 표, "넷플릭스 17,000원 매월 5일" 같은 메모를 붙여넣으세요. [고정수입]·[고정지출]·[할부] 같은 제목이 있으면 그대로 구분합니다.</p>
    <div class="row" style="margin-bottom:8px">
      <button type="button" class="btn sm ghost" data-act="clip">📋 클립보드에서 붙여넣기</button>
      <button type="button" class="link-btn" data-act="clear">지우기</button>
    </div>
    <textarea name="fixedText" rows="6" placeholder="| 항목명 | 월 금액 | 결제일 | 카테고리 |&#10;| 월세 | 650,000원 | 1일 | 주거/관리비 |"></textarea>
    <div id="fixedPreview"></div>`,
    () => saveFixedItems());
  const ta = form.querySelector('textarea');
  const submit = form.querySelector('button[type=submit]');
  const label = () => { const n = fixedItems.filter(x => x.on).length; return n ? `${n}건 등록` : '등록'; };
  const update = () => { fixedItems = buildFixedItems(ta.value); renderFixedPreview(); submit.textContent = label(); };
  ta.addEventListener('input', update);
  form.querySelector('[data-act=clear]').onclick = () => { ta.value = ''; update(); ta.focus(); };
  form.querySelector('[data-act=clip]').onclick = async () => {
    try { ta.value = await navigator.clipboard.readText(); update(); }
    catch { alert('클립보드를 읽을 수 없어요. 입력칸을 길게 눌러 직접 붙여넣어 주세요.'); ta.focus(); }
  };
  form.querySelector('#fixedPreview').addEventListener('input', e => {
    const i = Number(e.target.closest('[data-i]')?.dataset.i);
    if (Number.isNaN(i)) return;
    const it = fixedItems[i], f = e.target.dataset.f;
    if (f === 'on') { it.on = e.target.checked; e.target.closest('.sms-item').classList.toggle('off', !it.on); }
    else if (f === 'amount') { it.amount = parseAmount(e.target.value); e.target.value = moneyVal(it.amount); }
    else if (f === 'day') it.day = Math.min(31, Math.max(0, Number(e.target.value) || 0)) || '';
    else it[f] = e.target.value;
    submit.textContent = label();
  });
  submit.textContent = label();
  setTimeout(() => ta.focus(), 50);
}

const normName = s => String(s).replace(/\s|\(.*?\)|주식회사|㈜/g, '').toLowerCase();
function buildFixedItems(text) {
  return SmsParser.parseFixedList(text, EXPENSE_CATS, INCOME_CATS).map(it => {
    const dup = state.fixed.some(f => normName(f.name) === normName(it.name));
    const off = it.kind === 'saving' || it.kind === 'card' || (it.type === 'income' && it.amount < 1000); // 분기 이자 몇십 원 같은 수입은 기본 제외
    return { ...it, dup, on: !dup && !off };
  });
}

function renderFixedPreview() {
  const box = form.querySelector('#fixedPreview');
  if (!fixedItems.length) {
    box.innerHTML = form.querySelector('textarea').value.trim() ? `<div class="empty">항목을 찾지 못했어요<br><span>한 줄에 이름과 금액(원)이 함께 있어야 합니다</span></div>` : '';
    return;
  }
  const on = fixedItems.filter(x => x.on);
  const tot = t => sum(on.filter(x => x.type === t));
  box.innerHTML = `<div class="muted" style="margin:14px 0 6px">${fixedItems.length}건 인식 · 선택한 항목: 수입 ${won(tot('income'))} / 지출 ${won(tot('expense'))}</div>
    ${fixedItems.some(x => x.kind === 'card') ? `<div class="tip warn"><b>카드대금은 기본 제외</b>카드 결제 항목을 따로 등록하면 같은 돈이 두 번 계산됩니다.</div>` : ''}
    ${fixedItems.some(x => x.kind === 'installment') ? `<div class="hint" style="margin-bottom:6px">할부는 종료 월이 지나면 자동으로 합계에서 빠집니다. 원래 결제를 내역에 일시불로 따로 기록했다면 체크를 해제하세요(이중 계산).</div>` : ''}
    ${fixedItems.map((it, i) => `
    <div class="sms-item ${it.on ? '' : 'off'}" data-i="${i}">
      <div class="row">
        <label class="chk"><input type="checkbox" data-f="on" ${it.on ? 'checked' : ''}>
          <span class="pill ${it.type === 'income' ? 'ok' : it.kind === 'expense' ? '' : 'bad'}">${KIND_LABEL[it.kind]}</span>
          ${it.guess ? '<span class="pill bad">추정</span>' : ''}${it.dup ? '<span class="pill bad">이미 있음</span>' : ''}</label>
        <input class="amt ${it.type}" data-f="amount" inputmode="numeric" value="${moneyVal(it.amount)}">
      </div>
      <div class="sms-fields">
        <input data-f="name" value="${esc(it.name)}" maxlength="30">
        <select data-f="category">${catOptions(it.type, it.category)}</select>
        <label class="day-field">매월<input data-f="day" type="number" min="1" max="31" placeholder="–" value="${it.day || ''}">일</label>
        ${it.kind === 'installment' ? `<input data-f="until" type="month" value="${it.until}" style="grid-column:1/-1">` : ''}
      </div>
    </div>`).join('')}`;
}

function saveFixedItems() {
  const picked = fixedItems.filter(x => x.on && x.amount > 0 && x.name.trim());
  if (!picked.length) { alert('등록할 항목을 선택하세요'); return false; }
  for (const it of picked) {
    state.fixed.push({ id: uid(), type: it.type, name: it.name.trim(), amount: it.amount, category: it.category, day: it.day || '', ...(it.until ? { until: it.until } : {}) });
  }
  setTimeout(() => toast(`고정 항목 ${picked.length}건 등록`), 100);
}

function renderGoals() {
  const avg = avgStats();
  view.innerHTML = `
    <section class="card">
      <div class="row"><h2>내 목표</h2><button class="btn sm" data-add-goal>＋ 목표 추가</button></div>
      <p class="muted">월 여유자금 <b>${won(avg.net)}</b> · ${basisText(avg)}${avg.hasData ? '' : ' (변동지출 기록 없음 — 고정 항목만 반영)'}.<br>목표가 여러 개면 여유자금을 각 목표의 필요 적립액 비율로 나눠 계산합니다.</p>
    </section>
    ${state.goals.length ? state.goals.map(g => goalCard(g, avg)).join('') : `<section class="card"><div class="empty">목표 금액과 기한을 정하면<br>매달 얼마를 모아야 하는지, 무엇을 줄이면 되는지 알려드려요.</div></section>`}
  `;
}

function goalCard(g, avg) {
  const p = goalPlan(g, avg);
  const ok = p.shortfall <= 0;
  const eta = p.etaMonths === Infinity ? '현재 여유자금으로는 도달 불가' : `${shiftMonth(ym(new Date()), p.etaMonths).replace('-', '년 ')}월 (${p.etaMonths}개월 후)`;
  let advice = '';
  if (ok) {
    advice = `<div class="tip good"><b>현재 페이스로 달성 가능</b>매달 <b>${won(p.need)}</b>을 이 목표 전용 계좌로 <b>월급날 자동이체</b> 걸어두세요. 남는 돈을 모으는 방식은 대부분 실패합니다.</div>`;
  } else {
    advice = `<div class="tip warn"><b>매달 ${won(p.shortfall)} 부족</b>지금 여유자금 중 이 목표 몫은 월 ${won(p.share)}입니다.</div>`;
    if (p.cuts.length) {
      advice += `<h3>이렇게 줄이면 ${p.cutsCover ? '메울 수 있어요' : '일부 메울 수 있어요'}</h3>
        <table class="mini">${p.cuts.map(c => `<tr><td>${esc(c.category)} (현재 월 ${shortWon(c.current)}원)</td><td>−${won(c.cut)}</td></tr>`).join('')}</table>`;
    }
    if (!p.cutsCover) {
      advice += `<div class="tip warn"><b>지출 절감만으로는 부족</b>남는 부족분 월 ${won(p.remainingAfterCuts)}. 선택지: ① 기한을 늘리기 (현재 페이스 기준 도달: ${eta}) ② 목표 금액 조정 ③ 고정지출(통신·보험·구독) 재점검 ④ 수입 늘리기.</div>`;
    }
  }
  const horizon = p.months <= 12 ? '1년 이내 — 원금 손실 위험 있는 투자는 피하고 예·적금/파킹통장/CMA 권장'
    : p.months <= 36 ? '1~3년 — 예금·채권형 위주, 주식 비중은 작게'
    : '3년 이상 — 일부를 분산된 지수 ETF 등에 장기투자하는 것을 고려할 수 있음 (손실 가능)';
  return `<section class="card">
    <div class="row"><h2>${esc(g.name)}</h2><button class="link-btn" data-edit-goal="${g.id}">수정</button></div>
    <div class="row"><span class="big">${shortWon(g.saved)}</span><span class="muted">/ ${won(g.target)}</span></div>
    <div class="bar ${ok ? '' : 'over'}"><i style="width:${Math.min(100, p.progress)}%"></i></div>
    <table class="mini" style="margin-top:10px">
      <tr><td>기한</td><td>${g.deadline.replace('-', '년 ')}월 (${p.months}개월 남음)</td></tr>
      <tr><td>가정 연수익률</td><td>${g.rate}%</td></tr>
      <tr><td>필요 월 적립액</td><td><b>${won(p.need)}</b></td></tr>
      <tr><td>현재 페이스 도달 시점</td><td>${eta}</td></tr>
    </table>
    ${advice}
    <p class="muted">기간: ${horizon}</p>
  </section>`;
}

function renderInsights() {
  const avg = avgStats();
  const tips = buildTips(avg);
  const st = state.settings;
  const monthlyExp = avg.expense;
  const efTarget = monthlyExp * 3;
  const efOk = monthlyExp > 0 && st.emergency >= efTarget;
  view.innerHTML = `
    ${accountCardHtml()}
    <section class="card">
      <h2>절약 포인트</h2>
      <p class="muted">${basisText(avg)} · 기준치는 일반적인 가이드일 뿐 정답이 아닙니다.</p>
      ${tips.length ? tips.map(t => `<div class="tip ${t.level || ''}"><b>${esc(t.title)}</b>${t.body}</div>`).join('') : `<div class="empty">기록이 쌓이면(최소 2~4주) 분석해드려요.</div>`}
    </section>

    <section class="card">
      <h2>투자 순서 가이드</h2>
      <p class="muted">이 앱은 실시간 시장 정보를 모릅니다. "요즘 뭐가 오른다"는 추천은 하지 않으며, 대신 개인 재무 상황에 맞는 <b>순서</b>를 알려드립니다. 금리·세제 혜택은 바뀌므로 가입 전 반드시 최신 조건을 확인하세요.</p>
      <ol class="ladder">
        <li class="${st.highDebt ? '' : 'done'}"><b>고금리 빚부터 갚기</b> — 카드론·현금서비스·리볼빙(연 10%+)을 갚는 건 확정 수익률 10%+ 투자와 같습니다. ${st.highDebt ? '<span class="pill bad">해당</span>' : '<span class="pill ok">없음</span>'}</li>
        <li class="${efOk ? 'done' : ''}"><b>비상금 3~6개월치</b> — 월 지출 기준 최소 ${won(efTarget)}. 파킹통장·CMA·MMF처럼 바로 꺼낼 수 있는 곳에. 현재 ${won(st.emergency)} ${efOk ? '<span class="pill ok">충족</span>' : '<span class="pill bad">부족</span>'}</li>
        <li><b>세제혜택 계좌 먼저 채우기</b> — 연금저축·IRP(세액공제, 대신 55세 전 인출 시 불이익), ISA(비과세·분리과세). 같은 상품도 이 계좌에서 사면 세금이 줄어듭니다.</li>
        <li><b>장기 돈은 넓게 분산</b> — 3년 이상 안 쓸 돈은 국내외 주식·채권 지수 ETF 같은 저비용 분산 상품을 매달 정액 적립하는 방식이 개인에게 가장 재현성이 높습니다. 손실 가능성은 항상 있습니다.</li>
        <li><b>개별 종목·코인·레버리지</b> — 하고 싶다면 전체 자산의 일부, 잃어도 생활에 지장 없는 금액만.</li>
      </ol>
    </section>

    <section class="card">
      <h2>내 상태 입력</h2>
      <label>현재 비상금 (바로 쓸 수 있는 현금성 자산)</label>
      <input id="setEmergency" inputmode="numeric" value="${st.emergency ? st.emergency.toLocaleString('ko-KR') : ''}" placeholder="0" />
      <label style="display:flex;align-items:center;gap:8px;color:var(--text)"><input type="checkbox" id="setDebt" style="width:auto" ${st.highDebt ? 'checked' : ''}/> 연 10% 이상 고금리 대출/카드빚이 있다</label>
    </section>

    <section class="card">
      <div class="row"><h2>데이터</h2><span class="muted">억 ${APP_VERSION}</span></div>
      <p class="muted">데이터는 이 기기에 먼저 저장되고, 로그인하면 클라우드와 동기화됩니다. 로그인하지 않으면 이 기기에만 있으니 <b>주기적으로 백업하세요.</b></p>
      <div class="actions">
        <button class="btn ghost" id="exportBtn">백업 내보내기</button>
        <button class="btn ghost" id="importBtn">백업 불러오기</button>
      </div>
      <input type="file" id="importFile" accept="application/json,.json" hidden />
      <div class="actions"><button class="btn ghost" id="updateBtn">업데이트 확인</button><button class="btn danger" id="resetBtn">전체 초기화</button></div>
    </section>
  `;
}

function accountCardHtml() {
  const st = window.EokSync?.status() || { phase: 'loading' };
  const time = st.last ? new Date(st.last).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';
  let body;
  if (st.phase === 'noconfig') body = `<p class="muted">클라우드 설정 전이에요. 지금은 이 기기에만 저장됩니다.</p>`;
  else if (st.phase === 'loading') body = `<p class="muted">로그인 확인 중…</p>`;
  else if (st.phase === 'offline') body = `<p class="muted">오프라인 — 연결되면 로그인할 수 있어요. 기록은 이 기기에 계속 저장됩니다.</p>`;
  else if (st.phase === 'error') body = `<p class="muted">${esc(st.error)}</p>`;
  else if (!st.user) body = `<p class="muted">로그인하면 폰을 바꾸거나 다른 기기에서도 같은 데이터를 볼 수 있어요.</p>
      <button class="btn block" id="loginBtn">Google로 로그인</button>`;
  else body = `<div class="row"><div><div class="title">${esc(st.user.name || '')}</div><div class="muted">${esc(st.user.email || '')}</div></div>
      <button class="link-btn" id="logoutBtn">로그아웃</button></div>
      <div class="row" style="margin-top:8px"><span class="muted">${st.phase === 'syncing' ? '동기화 중…' : time ? `마지막 동기화 ${time}` : '동기화 대기'}</span>
      <button class="btn sm ghost" id="syncBtn">지금 동기화</button></div>
      <h3>결제 알림 자동 수집</h3>
      <p class="muted" style="margin:0 0 8px">폰 자동화 앱(MacroDroid)이 카드 문자·카톡 알림을 클라우드 수집함으로 보내면, 억을 열 때 자동 등록됩니다.</p>
      <div id="dropBox">${dropHtml()}</div>`;
  return `<section class="card" id="accountCard"><h2>계정</h2>${body}${st.error && st.user ? `<div class="tip warn"><b>동기화 문제</b>${esc(st.error)}</div>` : ''}</section>`;
}
let dropShown = null; // 자동 수집 설정값(한 번 불러오면 카드 다시 그려도 유지)
function dropHtml() {
  if (!dropShown) return '<button class="btn sm ghost" id="dropBtn">설정값 보기</button>';
  if (dropShown.error) return `<p class="muted">불러오기 실패: ${esc(dropShown.error)}</p><button class="btn sm ghost" id="dropBtn">다시 시도</button>`;
  if (dropShown.loading) return '<p class="muted">불러오는 중…</p>';
  const body = `{"fields":{"text":{"stringValue":"[notification_title] [notification]"},"key":{"stringValue":"${dropShown.key}"}}}`;
  return `
    <label>① 요청 주소 (POST)</label><div class="codebox" id="dropUrl">${esc(dropShown.url)}</div><button class="link-btn" data-copy="dropUrl">복사</button>
    <label>② 본문 (Content-Type: application/json)</label><div class="codebox" id="dropBody">${esc(body)}</div><button class="link-btn" data-copy="dropBody">복사</button>
    <p class="hint">열쇠(key)를 아는 사람은 수집함에 글을 넣을 수 있으니 공유하지 마세요. 읽기·삭제는 본인 로그인으로만 가능합니다.</p>`;
}
async function showDrop() {
  dropShown = { loading: true }; refreshAccount();
  try { dropShown = await window.EokSync.dropInfo(true); }
  catch (e) { dropShown = { error: e.message || String(e) }; }
  refreshAccount();
}
function refreshAccount() {
  const el = document.getElementById('accountCard');
  if (el) el.outerHTML = accountCardHtml();
}
// 자동 수집: 알림 원문들을 문자 입력과 같은 규칙으로 해석해 바로 등록
// (중복 의심·고정 항목과 겹침은 건너뜀, 승인취소는 원 거래 삭제). 등록된 거래에는 auto 표시.
function ingest(texts) {
  const items = buildSmsItems(texts.join('\n\n'));
  let added = 0, removed = 0;
  for (const it of items) {
    if (!it.on) continue;
    if (it.type === 'cancel') { if (it.cancelTarget) { state.tx = state.tx.filter(t => t.id !== it.cancelTarget); removed++; } continue; }
    state.tx.push({ id: uid(), type: it.type, amount: it.amount, category: it.category, memo: it.memo.trim(), date: it.date, auto: true });
    added++;
  }
  if (added || removed) { save(); if (!sheet.open) render(); }
  toast(`자동 수집 ${texts.length}건 → ${added}건 등록${removed ? ` · ${removed}건 취소 반영` : ''}${texts.length - added - removed > 0 ? ` · ${texts.length - added - removed}건 제외(중복·고정·인식 불가)` : ''}`);
}
window.EokApp = { getState: () => state, adopt, refreshAccount, ingest };

function buildTips(avg) {
  const tips = [];
  const inc = avg.income;
  if (!avg.hasData && state.fixed.length === 0) return tips;
  const rate = inc > 0 ? avg.net / inc : 0;

  if (inc <= 0) {
    tips.push({ level: 'warn', title: '수입이 등록되지 않았어요', body: "'고정' 탭에 월급을 등록하거나 수입 내역을 기록해야 저축률을 계산할 수 있어요." });
  } else if (avg.net < 0) {
    tips.push({ level: 'warn', title: `적자: 매달 평균 ${won(-avg.net)} 초과 지출`, body: '목표·투자보다 적자 해소가 먼저입니다. 아래 항목 중 큰 것부터 줄이세요.' });
  } else if (rate < 0.1) {
    tips.push({ level: 'warn', title: `저축률 ${Math.round(rate * 100)}% — 낮음`, body: '흔히 쓰는 기준은 최소 20%입니다. 월급날 저축액을 먼저 자동이체로 빼고 남은 돈으로 생활하는 "선저축 후지출"로 바꿔보세요.' });
  } else if (rate >= 0.3) {
    tips.push({ level: 'good', title: `저축률 ${Math.round(rate * 100)}% — 좋음`, body: '모이는 돈이 그냥 입출금 통장에 머물지 않도록 목표별 계좌로 나눠 두세요.' });
  } else {
    tips.push({ title: `저축률 ${Math.round(rate * 100)}%`, body: '나쁘지 않습니다. 20~30% 구간을 유지하면 목표 달성 속도가 안정적이에요.' });
  }

  if (inc > 0 && avg.fixedExpense / inc > 0.5) {
    tips.push({ level: 'warn', title: `고정지출이 수입의 ${pct(avg.fixedExpense, inc)}%`, body: '고정지출은 한 번 줄이면 매달 효과가 반복됩니다. 통신 요금제(알뜰폰), 중복 보험, 안 쓰는 구독부터 확인하세요.' });
  }
  const subs = state.fixed.filter(f => f.type === 'expense' && f.category === '구독');
  if (subs.length) {
    const t = sum(subs);
    tips.push({ title: `구독 ${subs.length}개 · 월 ${won(t)} (연 ${won(t * 12)})`, body: '지난 한 달간 한 번도 안 쓴 구독은 해지하세요. 필요할 때 다시 가입하면 됩니다.' });
  }

  const cafe = avg.byCat['카페/간식'] || 0;
  if (cafe >= 50000) {
    tips.push({ title: `카페/간식 월 ${won(cafe)} → 1년 ${won(cafe * 12)}`, body: `절반만 줄여도 연 ${won(cafe * 6)}입니다. 주 몇 회로 횟수 상한을 정하는 방식이 "참기"보다 오래 갑니다.` });
  }
  const food = avg.byCat['식비'] || 0;
  if (inc > 0 && food / inc > 0.2) {
    tips.push({ level: 'warn', title: `식비가 수입의 ${pct(food, inc)}%`, body: '배달·외식 비중이 큰지 내역을 확인해보세요. 배달 1회를 장보기로 바꾸면 보통 절반 이하 비용입니다.' });
  }
  const shop = avg.byCat['쇼핑'] || 0;
  if (inc > 0 && shop / inc > 0.1) {
    tips.push({ title: `쇼핑 월 ${won(shop)} (수입의 ${pct(shop, inc)}%)`, body: '장바구니에 넣고 48시간 뒤에 결제하는 규칙만으로도 충동구매가 상당히 줄어듭니다.' });
  }

  // 최근 3개월 소액 반복 지출
  const now = ym(new Date());
  const recentMonths = [0, 1, 2].map(i => shiftMonth(now, -i));
  const small = state.tx.filter(t => t.type === 'expense' && t.amount < 10000 && recentMonths.some(m => t.date.startsWith(m)));
  if (small.length >= 20) {
    const months = Math.max(1, avg.months);
    tips.push({ title: `1만원 미만 소액 결제 월 ${Math.round(small.length / months)}건 · 월 ${won(sum(small) / months)}`, body: '하나하나는 작아도 합치면 큽니다. 편의점·간식·앱 결제가 주로 어디서 나오는지 확인해보세요.' });
  }

  // 이번 달 vs 평균 급증 카테고리
  const cur = monthStats(now);
  const prevAvg = (() => {
    const ms = [1, 2, 3].map(i => monthStats(shiftMonth(now, -i))).filter(s => s.txCount > 0);
    if (!ms.length) return null;
    const o = {};
    ms.forEach(s => Object.entries(s.byCat).forEach(([k, v]) => { o[k] = (o[k] || 0) + v / ms.length; }));
    return o;
  })();
  if (prevAvg) {
    Object.entries(cur.byCat).forEach(([c, v]) => {
      const p = prevAvg[c] || 0;
      if (p > 0 && v > p * 1.3 && v - p >= 30000) {
        tips.push({ level: 'warn', title: `이번 달 ${c} 지출 증가`, body: `평소 월 ${won(p)} → 이번 달 ${won(v)} (+${pct(v - p, p)}%). 아직 월말 전이라면 남은 기간 조절하세요.` });
      }
    });
  }
  return tips;
}

/* ===================== 입력 시트 ===================== */
const sheet = $('#sheet');
const form = $('#sheetForm');

function openSheet(html, onSubmit, onDelete) {
  form.innerHTML = html + `<div class="actions">
      ${onDelete ? '<button type="button" class="btn danger" data-act="delete">삭제</button>' : ''}
      <button type="button" class="btn ghost" data-act="cancel">취소</button>
      <button type="submit" class="btn">저장</button></div>`;
  form.onsubmit = e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    if (onSubmit(fd) !== false) { save(); sheet.close(); render(); }
  };
  form.querySelector('[data-act=cancel]').onclick = () => sheet.close();
  const smsLink = form.querySelector('[data-act=sms]');
  if (smsLink) smsLink.onclick = () => { sheet.close(); openSmsSheet(); };
  if (onDelete) form.querySelector('[data-act=delete]').onclick = () => {
    if (confirm('삭제할까요?')) { onDelete(); save(); sheet.close(); render(); }
  };
  // 금액 입력 시 천단위 콤마
  form.querySelectorAll('[data-money]').forEach(inp => {
    inp.addEventListener('input', () => {
      const n = parseAmount(inp.value);
      inp.value = n ? n.toLocaleString('ko-KR') : '';
    });
  });
  // 수입/지출 전환 시 카테고리 목록 교체
  form.querySelectorAll('input[name=type]').forEach(r => r.addEventListener('change', () => {
    const sel = form.querySelector('select[name=category]');
    if (sel) sel.innerHTML = catOptions(r.value, '');
  }));
  sheet.showModal();
  const first = form.querySelector('[data-money]');
  if (first && !first.value) setTimeout(() => first.focus(), 50);
}

const catOptions = (type, selected) =>
  (type === 'income' ? INCOME_CATS : EXPENSE_CATS).map(c => `<option ${c === selected ? 'selected' : ''}>${c}</option>`).join('');
const typeSeg = type => `<div class="seg">
    <input type="radio" name="type" id="tExp" value="expense" ${type === 'expense' ? 'checked' : ''}><label for="tExp">지출</label>
    <input type="radio" name="type" id="tInc" value="income" ${type === 'income' ? 'checked' : ''}><label for="tInc">수입</label>
  </div>`;
const moneyVal = n => (n ? Number(n).toLocaleString('ko-KR') : '');

function openTxSheet(t) {
  const isNew = !t;
  t = t || { type: 'expense', amount: '', category: '식비', memo: '', date: selectedDay || (viewMonth === ym(new Date()) ? todayStr() : viewMonth + '-01') };
  openSheet(`<div class="row"><h2>${isNew ? '내역 추가' : '내역 수정'}</h2>${isNew ? '<button type="button" class="link-btn" data-act="sms">문자·카톡으로 입력 ›</button>' : ''}</div>
    ${typeSeg(t.type)}
    <label>금액</label><input name="amount" data-money inputmode="numeric" required value="${moneyVal(t.amount)}" placeholder="0" />
    <label>카테고리</label><select name="category">${catOptions(t.type, t.category)}</select>
    <label>메모</label><input name="memo" value="${esc(t.memo)}" placeholder="예: 점심, 편의점" maxlength="40" />
    <label>날짜</label><input name="date" type="date" required value="${t.date}" />`,
    fd => {
      const amount = parseAmount(fd.amount);
      if (!amount) { alert('금액을 입력하세요'); return false; }
      const rec = { id: t.id || uid(), type: fd.type, amount, category: fd.category, memo: fd.memo.trim(), date: fd.date };
      if (isNew) state.tx.push(rec); else state.tx[state.tx.findIndex(x => x.id === t.id)] = rec;
      viewMonth = rec.date.slice(0, 7);
    },
    isNew ? null : () => { state.tx = state.tx.filter(x => x.id !== t.id); });
}

function openFixedSheet(f, type) {
  const isNew = !f;
  f = f || { type: type || 'expense', name: '', amount: '', category: type === 'income' ? '급여' : '주거/관리비', day: '' };
  openSheet(`<h2>${isNew ? '고정 항목 추가' : '고정 항목 수정'}</h2>
    ${typeSeg(f.type)}
    <label>이름</label><input name="name" required value="${esc(f.name)}" placeholder="예: 월세, 넷플릭스, 월급" maxlength="30" />
    <label>월 금액</label><input name="amount" data-money inputmode="numeric" required value="${moneyVal(f.amount)}" placeholder="0" />
    <label>카테고리</label><select name="category">${catOptions(f.type, f.category)}</select>
    <label>매월 결제/입금일 (선택)</label><input name="day" type="number" min="1" max="31" value="${f.day || ''}" />
    <label>마지막 달 (할부 등 끝나는 항목만)</label><input name="until" type="month" value="${f.until || ''}" />
    <div class="hint">연 단위 지출(자동차보험 등)은 12로 나눈 금액을 넣으세요.</div>`,
    fd => {
      const amount = parseAmount(fd.amount);
      if (!amount || !fd.name.trim()) { alert('이름과 금액을 입력하세요'); return false; }
      const rec = { id: f.id || uid(), type: fd.type, name: fd.name.trim(), amount, category: fd.category, day: Number(fd.day) || '', ...(fd.until ? { until: fd.until } : {}) };
      if (isNew) state.fixed.push(rec); else state.fixed[state.fixed.findIndex(x => x.id === f.id)] = rec;
    },
    isNew ? null : () => { state.fixed = state.fixed.filter(x => x.id !== f.id); });
}

function openGoalSheet(g) {
  const isNew = !g;
  g = g || { name: '', target: '', saved: '', deadline: shiftMonth(ym(new Date()), 12), rate: 3 };
  openSheet(`<h2>${isNew ? '목표 추가' : '목표 수정'}</h2>
    <label>목표 이름</label><input name="name" required value="${esc(g.name)}" placeholder="예: 전세 보증금, 비상금, 여행" maxlength="30" />
    <label>목표 금액</label><input name="target" data-money inputmode="numeric" required value="${moneyVal(g.target)}" />
    <label>현재 모은 금액</label><input name="saved" data-money inputmode="numeric" value="${moneyVal(g.saved)}" placeholder="0" />
    <label>목표 시점</label><input name="deadline" type="month" required value="${g.deadline}" min="${shiftMonth(ym(new Date()), 1)}" />
    <label>가정 연수익률 (%)</label><input name="rate" type="number" step="0.1" min="0" max="20" value="${g.rate}" />
    <div class="hint">예·적금이면 세후 2~3%대, 주식형 장기투자도 보수적으로 4~6% 정도로 잡는 게 안전합니다. 높게 잡을수록 계획이 낙관적이 됩니다.</div>`,
    fd => {
      const target = parseAmount(fd.target);
      if (!target || !fd.name.trim()) { alert('이름과 목표 금액을 입력하세요'); return false; }
      const rec = { id: g.id || uid(), name: fd.name.trim(), target, saved: parseAmount(fd.saved), deadline: fd.deadline, rate: Math.max(0, Number(fd.rate) || 0) };
      if (isNew) state.goals.push(rec); else state.goals[state.goals.findIndex(x => x.id === g.id)] = rec;
    },
    isNew ? null : () => { state.goals = state.goals.filter(x => x.id !== g.id); });
}


/* ===================== 문자·카톡 붙여넣기 ===================== */
let smsItems = [];

function openSmsSheet(initialText = '') {
  smsItems = [];
  openSheet(`<h2>문자·카톡 알림으로 입력</h2>
    <p class="muted" style="margin:-8px 0 10px">카드 승인·은행 입출금 문자나 카카오톡 알림톡을 복사해서 붙여넣으세요. 여러 건을 한 번에 붙여넣어도 됩니다.</p>
    <div class="row" style="margin-bottom:8px">
      <button type="button" class="btn sm ghost" data-act="clip">📋 클립보드에서 붙여넣기</button>
      <button type="button" class="link-btn" data-act="clear">지우기</button>
    </div>
    <textarea name="smsText" rows="5" placeholder="[Web발신]&#10;신한카드(1234)승인 홍*동 12,500원(일시불)11/15 12:34 스타벅스"></textarea>
    <div id="smsPreview"></div>`,
    () => saveSmsItems());
  const ta = form.querySelector('textarea[name=smsText]');
  const submit = form.querySelector('button[type=submit]');
  const update = () => { smsItems = buildSmsItems(ta.value); renderSmsPreview(); };
  ta.addEventListener('input', update);
  form.querySelector('[data-act=clear]').onclick = () => { ta.value = ''; update(); ta.focus(); };
  form.querySelector('[data-act=clip]').onclick = async () => {
    try { ta.value = await navigator.clipboard.readText(); update(); }
    catch { alert('클립보드를 읽을 수 없어요. 입력칸을 길게 눌러 직접 붙여넣어 주세요.'); ta.focus(); }
  };
  // 미리보기 항목 편집 → smsItems 반영
  form.querySelector('#smsPreview').addEventListener('input', e => {
    const i = Number(e.target.closest('[data-i]')?.dataset.i);
    if (Number.isNaN(i)) return;
    const it = smsItems[i], f = e.target.dataset.f;
    if (f === 'on') { it.on = e.target.checked; e.target.closest('.sms-item').classList.toggle('off', !it.on); }
    else if (f === 'amount') { it.amount = parseAmount(e.target.value); e.target.value = moneyVal(it.amount); }
    else it[f] = e.target.value;
    submit.textContent = saveLabel();
  });
  if (initialText) { ta.value = initialText; update(); }
  submit.textContent = saveLabel();
  if (!initialText) setTimeout(() => ta.focus(), 50);
}

function buildSmsItems(text) {
  const { results, skipped } = SmsParser.parseNotifications(text);
  buildSmsItems.skipped = skipped;
  return results.map(r => {
    const memo = r.merchant || (r.type === 'income' ? '입금' : '카드 결제');
    const learned = state.merchantCats?.[memo];
    const type = r.type === 'cancel' ? 'cancel' : r.type;
    const category = learned && type !== 'cancel' && (type === 'income' ? INCOME_CATS : EXPENSE_CATS).includes(learned) ? learned : r.category;
    const dup = type !== 'cancel' && state.tx.some(t => t.date === r.date && t.amount === r.amount && (t.memo === memo || t.type === type));
    const cancelTarget = type === 'cancel' ? findCancelTarget(r.amount, memo, r.date) : null;
    // 카드로 나가는 구독·통신·보험은 고정 탭에도 있으므로, 같은 결제 문자가 오면 이중 계산이 된다
    const fixedHit = type === 'expense' && state.fixed.find(f => f.type === 'expense' &&
      Math.abs(f.amount - r.amount) <= f.amount * 0.05 &&
      (normName(f.name).slice(0, 2) === normName(memo).slice(0, 2) || (f.day && Math.abs(Number(r.date.slice(8)) - f.day) <= 2)));
    return { type, amount: r.amount, date: r.date, memo, category, dup, fixedHit: fixedHit ? fixedHit.name : '', cancelTarget,
      on: type === 'cancel' ? !!cancelTarget : !dup && !fixedHit };
  });
}
function findCancelTarget(amount, memo, date) {
  const c = state.tx.filter(t => t.type === 'expense' && t.amount === amount);
  return (c.find(t => t.memo === memo) || c.find(t => t.date <= date && (memo.includes(t.memo) || t.memo.includes(memo))) || null)?.id || null;
}
function saveLabel() {
  const n = smsItems.filter(x => x.on).length;
  return n ? `${n}건 저장` : '저장';
}

function renderSmsPreview() {
  const box = form.querySelector('#smsPreview');
  const sk = buildSmsItems.skipped || 0;
  if (!smsItems.length) {
    box.innerHTML = form.querySelector('textarea').value.trim() ? `<div class="empty">결제·입출금 내용을 찾지 못했어요.<br><span>금액이 '원'과 함께 있는지 확인해주세요.</span></div>` : '';
    form.querySelector('button[type=submit]').textContent = saveLabel();
    return;
  }
  box.innerHTML = `<div class="muted" style="margin:14px 0 6px">${smsItems.length}건 인식${sk ? ` · ${sk}건은 결제 문자가 아니라서 제외` : ''} — 저장 전에 확인·수정하세요</div>
    ${smsItems.map((it, i) => `
    <div class="sms-item ${it.on ? '' : 'off'}" data-i="${i}">
      <div class="row">
        <label class="chk"><input type="checkbox" data-f="on" ${it.on ? 'checked' : ''}>
          <span class="pill ${it.type === 'income' ? 'ok' : it.type === 'cancel' ? 'bad' : ''}">${it.type === 'income' ? '수입' : it.type === 'cancel' ? '취소' : '지출'}</span>
          ${it.dup ? '<span class="pill bad">이미 있음?</span>' : ''}${it.fixedHit ? '<span class="pill bad">고정 항목</span>' : ''}</label>
        <input class="amt ${it.type}" data-f="amount" inputmode="numeric" value="${moneyVal(it.amount)}">
      </div>
      ${it.fixedHit ? `<div class="hint">고정 탭의 '${esc(it.fixedHit)}'와 같은 결제로 보여요. 저장하면 이중 계산됩니다.</div>` : ''}
      ${it.type === 'cancel'
        ? `<div class="hint">${it.cancelTarget ? '체크하면 기존 결제 내역 1건을 삭제합니다' : '취소할 원래 결제 내역을 찾지 못했어요 (저장 안 함)'}</div>`
        : `<div class="sms-fields">
            <input data-f="memo" value="${esc(it.memo)}" maxlength="40">
            <select data-f="category">${catOptions(it.type, it.category)}</select>
            <input data-f="date" type="date" value="${it.date}">
          </div>`}
    </div>`).join('')}`;
  form.querySelector('button[type=submit]').textContent = saveLabel();
}

function saveSmsItems() {
  const picked = smsItems.filter(x => x.on && x.amount > 0);
  if (!picked.length) { alert('저장할 항목을 선택하세요'); return false; }
  state.merchantCats = state.merchantCats || {};
  let added = 0, removed = 0;
  for (const it of picked) {
    if (it.type === 'cancel') {
      if (it.cancelTarget) { state.tx = state.tx.filter(t => t.id !== it.cancelTarget); removed++; }
      continue;
    }
    state.tx.push({ id: uid(), type: it.type, amount: it.amount, category: it.category, memo: it.memo.trim(), date: it.date });
    if (it.memo.trim()) state.merchantCats[it.memo.trim()] = it.category; // 다음에 같은 가맹점이면 이 카테고리로
    added++;
  }
  const last = picked.filter(x => x.type !== 'cancel').map(x => x.date).sort().pop();
  if (last) { viewMonth = last.slice(0, 7); selectedDay = null; }
  setTimeout(() => toast(`${added}건 추가${removed ? ` · ${removed}건 취소 반영` : ''}`), 100);
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

/* ===================== 이벤트 ===================== */
document.querySelector('.tabbar').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  currentTab = b.dataset.tab;
  render();
  window.scrollTo(0, 0);
});
$('#prevMonth').onclick = () => { selectedDay = null; viewMonth = shiftMonth(viewMonth, -1); render(); };
$('#nextMonth').onclick = () => { selectedDay = null; viewMonth = shiftMonth(viewMonth, 1); render(); };
$('#fab').onclick = () => openTxSheet();

view.addEventListener('click', e => {
  const el = e.target.closest('[data-import-fixed],[data-clear-ended],[data-sms],[data-day],[data-clear-day],[data-edit-tx],[data-edit-fixed],[data-add-fixed],[data-edit-goal],[data-add-goal],[data-goto],#exportBtn,#importBtn,#resetBtn,#updateBtn,#loginBtn,#logoutBtn,#syncBtn,#dropBtn,[data-copy]');
  if (!el) return;
  if ('importFixed' in el.dataset) openFixedImportSheet();
  else if ('clearEnded' in el.dataset) {
    const now = ym(new Date());
    if (confirm('끝난 할부를 목록에서 지울까요? (지난 달 통계에서도 빠집니다)')) { state.fixed = state.fixed.filter(f => !f.until || f.until >= now); save(); render(); }
  }
  else if ('sms' in el.dataset) openSmsSheet();
  else if (el.dataset.day) { selectedDay = selectedDay === el.dataset.day ? null : el.dataset.day; render(); }
  else if ('clearDay' in el.dataset) { selectedDay = null; render(); }
  else if (el.dataset.editTx) openTxSheet(state.tx.find(t => t.id === el.dataset.editTx));
  else if (el.dataset.editFixed) openFixedSheet(state.fixed.find(f => f.id === el.dataset.editFixed));
  else if (el.dataset.addFixed) openFixedSheet(null, el.dataset.addFixed);
  else if (el.dataset.editGoal) openGoalSheet(state.goals.find(g => g.id === el.dataset.editGoal));
  else if ('addGoal' in el.dataset) openGoalSheet();
  else if (el.dataset.goto) { currentTab = el.dataset.goto; render(); }
  else if (el.id === 'dropBtn') showDrop();
  else if (el.dataset.copy !== undefined) {
    const v = document.getElementById(el.dataset.copy)?.textContent || '';
    navigator.clipboard.writeText(v).then(() => toast('복사했어요'), () => toast('복사 실패 — 길게 눌러 직접 복사하세요'));
  }
  else if (el.id === 'loginBtn') window.EokSync?.login();
  else if (el.id === 'logoutBtn') window.EokSync?.logout();
  else if (el.id === 'syncBtn') window.EokSync?.syncNow();
  else if (el.id === 'updateBtn') {
    const reg = window.__swReg;
    if (!reg) { location.reload(); return; }
    toast('새 버전 확인 중…');
    reg.update().then(() => setTimeout(() => location.reload(), 800)).catch(() => location.reload());
  }
  else if (el.id === 'exportBtn') exportData();
  else if (el.id === 'importBtn') $('#importFile').click();
  else if (el.id === 'resetBtn') {
    if (confirm(`모든 데이터를 삭제합니다. 되돌릴 수 없어요.${window.EokSync?.status().user ? '\n로그인 상태라 클라우드와 다른 기기에서도 지워집니다.' : ''}\n계속할까요?`)) { state = defaultState(); save(); render(); }
  }
});
view.addEventListener('change', e => {
  if (e.target.name === 'txmode') { txMode = e.target.value; selectedDay = null; render(); return; }
  if (e.target.id === 'setEmergency') { state.settings.emergency = parseAmount(e.target.value); save(); render(); }
  if (e.target.id === 'setDebt') { state.settings.highDebt = e.target.checked; save(); render(); }
  if (e.target.id === 'importFile' && e.target.files[0]) importData(e.target.files[0]);
});

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `eok-backup-${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importData(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const s = JSON.parse(r.result);
      if (!Array.isArray(s.tx) || !Array.isArray(s.fixed) || !Array.isArray(s.goals)) throw new Error('형식이 올바르지 않습니다');
      if (!confirm('현재 데이터를 백업 파일 내용으로 덮어씁니다. 계속할까요?')) return;
      state = { ...defaultState(), ...s, settings: { ...defaultState().settings, ...(s.settings || {}) } };
      save(); render(); alert('불러오기 완료');
    } catch (err) { alert('불러오기 실패: ' + err.message); }
  };
  r.readAsText(file);
}

/* ===================== 시작 ===================== */
render();

// 안드로이드 공유하기(Web Share Target) 또는 ?text= 링크로 들어온 결제 문자 처리
(function handleSharedText() {
  const q = new URLSearchParams(location.search);
  const shared = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join('\n').trim();
  if (!shared) return;
  history.replaceState(null, '', location.pathname); // 새로고침 시 중복 입력 방지
  currentTab = 'tx';
  render();
  openSmsSheet(shared);
})();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then(reg => {
    window.__swReg = reg;
    // 앱을 다시 열거나 화면으로 돌아올 때마다 새 버전 확인
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(err => console.warn('SW 등록 실패', err));
  // 새 버전이 설치되면 한 번 자동 새로고침 (입력 중인 시트가 열려 있으면 닫힌 뒤에)
  let reloaded = false;
  const hadController = !!navigator.serviceWorker.controller; // 첫 설치 때는 새로고침하지 않음
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !hadController) return;
    const go = () => { reloaded = true; location.reload(); };
    if (sheet.open) sheet.addEventListener('close', go, { once: true }); else go();
  });
}
// 저장공간 영구화 요청 (브라우저가 임의로 지우지 않도록)
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
