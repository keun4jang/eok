'use strict';

/* ===================== 데이터 ===================== */
// 버전은 배포(scripts/deploy.sh) 때 version.js에 자동으로 매겨진다 — 손으로 올리지 않음
const APP_VERSION = window.EOK_VERSION?.n ? `v${window.EOK_VERSION.n}` : 'dev';
const STORAGE_KEY = 'moneyplan.v1'; // 앱 이름이 '억'으로 바뀌었지만 기존 데이터 호환을 위해 키 유지
const EXPENSE_CATS = ['식비', '카페/간식', '교통', '쇼핑', '생활용품', '주거/관리비', '통신', '구독', '보험', '문화/여가', '의료', '교육', '가족·커플', '경조사', '대출이자', '기타'];
const SAVING_CATS = ['주식·ETF', '적금·청약', '연금', '코인', '기타투자'];
const INCOME_CATS = ['급여', '부수입', '상여', '이자/배당', '용돈', '기타'];
// 줄이기 쉬운(재량) 지출 카테고리 — 목표 달성 부족분을 여기서 우선 깎는다
const DISCRETIONARY = ['카페/간식', '쇼핑', '문화/여가', '식비', '생활용품', '기타'];

// 카테고리 색: 채도를 낮춘 톤으로 통일 (골드·세이지·슬레이트·모브 계열)
const CAT_COLORS = {
  '식비': '#C8A96A', '카페/간식': '#B88A6A', '교통': '#7F93B5', '쇼핑': '#A88BA8', '생활용품': '#8FB8A0',
  '주거/관리비': '#6F8FA3', '통신': '#9AA6B8', '구독': '#C48E9A', '보험': '#8C9C7A', '문화/여가': '#D1B98A',
  '의료': '#7FA8A4', '교육': '#9C8FC4', '가족·커플': '#C79BA0', '주식·ETF': '#8FA8C8', '적금·청약': '#A3C2AE', '연금': '#BFAE8E', '코인': '#C8A96A', '기타투자': '#9AA6B8', '경조사': '#C9876F', '대출이자': '#A0705F', '기타': '#8A8F98',
  '급여': '#8FB8A0', '부수입': '#A3C2AE', '상여': '#C8A96A', '이자/배당': '#7FA8A4', '용돈': '#B5A3C4',
};
const catColor = c => CAT_COLORS[c] || '#8A8F98';
const catIcon = (c, type) => `<span class="cat-ic" style="--c:${catColor(c)}">${esc(String(c).charAt(0))}</span>`;

const defaultState = () => ({
  tx: [],      // {id, type:'income'|'expense', amount, category, memo, date:'YYYY-MM-DD'}
  fixed: [],   // {id, type, name, amount, category, day}
  goals: [],   // {id, name, target, saved, deadline:'YYYY-MM', rate}
  bills: [],   // 공과금 {id, name, cat, day, rec:{'YYYY-MM': 금액}, paid:{'YYYY-MM': true}}
  settings: { emergency: 0, highDebt: false },
  merchantCats: {}, // 가맹점 → 사용자가 고른 카테고리 (문자 입력 시 학습)
});

let state = load();
let snap = SyncCore.snapshot(state); // 마지막 저장 시점 스냅샷 — 저장할 때 바뀐 레코드에 수정 시각(u)을 찍는 데 사용
let currentTab = 'home';
let viewMonth = ym(new Date());
let viewMode = 'month'; // 'month' | 'year'
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
// 실제 기록 월: 과거 달을 '월 합계'(수입 포함)로 통째로 넣은 달. 이 달은 고정 항목·공과금 추정을 쓰지 않는다(이중 계산 방지).
const isActualMonth = m => state.tx.some(t => t.sum && t.type === 'income' && t.date.startsWith(m));
function monthStats(m) {
  const txs = state.tx.filter(t => t.date.startsWith(m));
  const actual = isActualMonth(m);
  const varIncome = sum(txs.filter(t => t.type === 'income'));
  const varExpense = sum(txs.filter(t => t.type === 'expense'));
  const fx = actual ? [] : activeFixed(m);
  const fixedIncome = sum(fx.filter(f => f.type === 'income'));
  const fixedExpense = sum(fx.filter(f => f.type === 'expense')) + (actual ? 0 : billsTotal(m));
  const saving = sum(fx.filter(f => f.type === 'saving')) + sum(txs.filter(t => t.type === 'saving'));
  const bills = actual ? 0 : billsTotal(m); // 공과금(월별 기록·추정)은 고정지출에 포함 // 고정 투자·저축: 지출 아님, 남는 돈에서만 뺌
  const byCat = {};
  txs.filter(t => t.type === 'expense').forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
  const income = varIncome + fixedIncome;
  const expense = varExpense + fixedExpense;
  return { m, txs, income, expense, varIncome, varExpense, fixedIncome, fixedExpense, saving, bills, actual, byCat, net: income - expense, left: income - expense - saving, txCount: txs.length };
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
  $('#monthLabel').textContent = viewMode === 'year' ? `${viewMonth.slice(0, 4)}년` : monthLabel(viewMonth);
  $('#monthPicker').style.visibility = (currentTab === 'home' || currentTab === 'tx') ? 'visible' : 'hidden';
  $('#fab').style.display = (currentTab === 'home' || currentTab === 'tx') ? '' : 'none';
  ({ home: renderHome, tx: renderTx, fixed: renderFixed, goals: renderGoals, insights: renderInsights })[currentTab]();
  view.insertAdjacentHTML('beforeend', `<footer class="credit">억 ${APP_VERSION} · 앱 제작자 KEUN</footer>`);
}

function renderHome() {
  if (viewMode === 'year') return renderYearHome();
  const s = monthStats(viewMonth);
  const rate = s.income > 0 ? Math.round((s.net / s.income) * 100) : 0;
  const cats = Object.entries(s.byCat).sort((a, b) => b[1] - a[1]);
  const recent = [...s.txs].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 5);
  const spentPct = s.income > 0 ? Math.min(100, pct(s.expense, s.income)) : 0;

  view.innerHTML = `
    <section class="hero">
      <div class="hero-label">${monthLabel(viewMonth)} 남은 돈</div>
      <div class="hero-amount ${s.left < 0 ? 'neg' : ''}">${won(s.left)}</div>
      <div class="hero-bar"><i style="width:${spentPct}%"></i></div>
      <div class="hero-meta"><span>지출 ${s.income > 0 ? pct(s.expense, s.income) : 0}%</span><span>저축률 ${s.income > 0 ? rate + '%' : '–'}</span></div>
      <div class="hero-split">
        <div><span>수입</span><b>${won(s.income)}</b></div>
        <div><span>지출</span><b>${won(s.expense)}</b></div>
        ${s.saving ? `<div><span>투자</span><b>${won(s.saving)}</b></div>` : ''}
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
        : `<div class="empty">기록 없음</div>`}
    </section>

    <section class="card">
      <div class="row"><h2>최근 내역</h2>${s.txs.length ? `<button class="link-btn" data-goto="tx">전체 ›</button>` : ''}</div>
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
  return `<section class="card"><div class="row"><h2>목표</h2><button class="link-btn" data-goto="goals">›</button></div>
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
    <div class="amount ${t.type === 'saving' ? 'income' : t.type}">${t.type === 'income' ? '+' : t.type === 'saving' ? '↗' : '−'}${won(t.amount)}</div>
  </li>`;
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
function renderTx() {
  if (viewMode === 'year') return renderYearTx();
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
    <div class="row" style="justify-content:flex-end;margin:-4px 0 6px"><button class="link-btn" data-month-sum>⇣ 월 합계</button></div>
    <button class="sms-cta" data-sms>
      <span class="cat-ic" style="--c:var(--gold)">✉</span>
      <span><b>문자·카톡 입력</b></span><span class="chev">›</span>
    </button>
    <section class="card grid2 compact">
      <div class="stat"><div class="label">기록된 수입</div><div class="value income">${won(s.varIncome)}</div></div>
      <div class="stat"><div class="label">기록된 지출</div><div class="value expense">${won(s.varExpense)}</div></div>
    </section>
    ${txMode === 'cal' ? calendar(s) : ''}
    ${selectedDay ? `<div class="row filter-chip"><span>📅 선택한 날</span><button class="link-btn" data-clear-day>✕</button></div>` : ''}
    ${list.length ? Object.entries(groups).map(([d, ts]) => `
      <section class="card">
        <div class="row day-head"><span>${dayLabel(d)}</span><span class="amount">${dayTotal(ts)}</span></div>
        <ul class="list">${ts.map(txItem).join('')}</ul>
      </section>`).join('') : `<section class="card"><div class="empty">기록 없음</div></section>`}
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
  if (fixedMode === 'bills') return renderBills();
  const now = ym(new Date());
  const active = activeFixed(now);
  const inc = active.filter(f => f.type === 'income');
  const exp = active.filter(f => f.type === 'expense' && !f.until && f.category !== '보험').sort((a, b) => b.amount - a.amount);
  const ins = active.filter(f => f.type === 'expense' && !f.until && f.category === '보험').sort((a, b) => b.amount - a.amount);
  const inst = active.filter(f => f.type === 'expense' && f.until).sort((a, b) => a.until.localeCompare(b.until));
  const ended = state.fixed.filter(f => f.until && f.until < now);
  const sav = active.filter(f => f.type === 'saving').sort((a, b) => b.amount - a.amount);
  const billNow = billsTotal(now);
  const expTotal = sum(exp) + sum(ins) + sum(inst) + billNow, incTotal = sum(inc);
  const endingSoon = sum(inst.filter(f => f.until === now));
  const item = f => `<li data-edit-fixed="${f.id}">
      <div class="li-main">${catIcon(f.category)}<div><div class="title">${esc(f.name)}</div><div class="sub">${esc(f.category)}${f.day ? ` · 매월 ${f.day}일` : ''}${f.until ? ` · ${untilLabel(f.until, now)}` : ''}</div></div></div>
      <div class="amount ${f.type}">${won(f.amount)}</div></li>`;
  view.innerHTML = `
    ${fixedSeg()}
    <section class="card">
      <div class="muted">이번 달 고정지출</div>
      <div class="big expense">${won(expTotal)}</div>
      <div class="muted">${incTotal ? `수입 대비 ${pct(expTotal, incTotal)}%` : '수입 미등록'}${inst.length ? ` · 할부 ${won(sum(inst))}` : ''}${billNow ? ` · 공과금 ${won(billNow)}` : ''}</div>
      ${sav.length ? `<div class="muted">투자 ${won(sum(sav))} · 남는 돈 ${won(incTotal - expTotal - sum(sav))}</div>` : ''}
      ${endingSoon ? `<div class="muted">다음 달 −${won(endingSoon)} (할부 끝)</div>` : ''}
    </section>
    <button class="sms-cta" data-import-fixed>
      <span class="cat-ic" style="--c:var(--gold)">⇣</span>
      <span><b>목록 붙여넣기</b></span><span class="chev">›</span>
    </button>
    <section class="card">
      <div class="row"><h2>수입 <span class="h-sum income">${won(incTotal)}</span></h2><button class="btn sm ghost" data-add-fixed="income">＋</button></div>
      ${inc.length ? `<ul class="list">${inc.map(item).join('')}</ul>` : `<div class="empty">없음</div>`}
    </section>
    <section class="card">
      <div class="row"><h2>지출 <span class="h-sum expense">${won(sum(exp))}</span></h2><button class="btn sm ghost" data-add-fixed="expense">＋</button></div>
      ${exp.length ? `<ul class="list">${exp.map(item).join('')}</ul>` : `<div class="empty">없음</div>`}
    </section>
    <section class="card">
      <div class="row"><h2>보험 <span class="h-sum expense">${won(sum(ins))}</span></h2><button class="btn sm ghost" data-add-fixed="insurance">＋</button></div>
      ${ins.length ? `<ul class="list">${ins.map(item).join('')}</ul>` : `<div class="empty">없음</div>`}
    </section>
    <section class="card">
      <div class="row"><h2>투자 <span class="h-sum income">${won(sum(sav))}</span></h2><button class="btn sm ghost" data-add-fixed="saving">＋</button></div>
      ${sav.length ? `<ul class="list">${sav.map(item).join('')}</ul>` : `<div class="empty">없음</div>`}
    </section>
    ${inst.length ? `<section class="card"><h2>할부 <span class="h-sum expense">${won(sum(inst))}</span></h2><ul class="list">${inst.map(item).join('')}</ul></section>` : ''}
    ${ended.length ? `<section class="card"><div class="row"><h2 class="muted">끝난 할부 ${ended.length}건</h2><button class="link-btn" data-clear-ended>정리</button></div></section>` : ''}
  `;
}
const activeFixed = m => state.fixed.filter(f => !f.until || m <= f.until);
function untilLabel(until, now) {
  const left = monthDiff(now, until) + 1;
  return `${until.replace('-', '.')}까지 (${left}회 남음)`;
}

/* ===================== 고정 항목 일괄 등록 ===================== */
let fixedItems = [];
const KIND_LABEL = { income: '수입', expense: '지출', installment: '할부', saving: '투자', card: '카드대금' };

function openFixedImportSheet(initialText = '') {
  fixedItems = [];
  openSheet(`<h2>목록 붙여넣기</h2>
    <div class="row" style="margin-bottom:8px">
      <span><button type="button" class="btn sm ghost" data-act="clip">📋 붙여넣기</button> <button type="button" class="btn sm ghost" data-act="ai">✨ AI</button></span>
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
  form.querySelector('[data-act=ai]').onclick = async e => {
    if (!ta.value.trim() || !window.EokAI?.consent()) return;
    const btn = e.target; btn.disabled = true; btn.textContent = '✨ …';
    try { fixedItems = fixedItemsFrom(await EokAI.parseFixed(ta.value, EXPENSE_CATS, INCOME_CATS)); renderFixedPreview(); submit.textContent = label(); toast(`AI ${fixedItems.length}건`); }
    catch (err) { toast(err.message || 'AI 실패'); }
    finally { btn.disabled = false; btn.textContent = '✨ AI'; }
  };
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
  if (initialText) { ta.value = initialText; update(); }
  submit.textContent = label();
  if (!initialText) setTimeout(() => ta.focus(), 50);
}

const normName = s => String(s).replace(/\s|\(.*?\)|주식회사|㈜/g, '').toLowerCase();
function buildFixedItems(text) { return fixedItemsFrom(SmsParser.parseFixedList(text, EXPENSE_CATS, INCOME_CATS)); }
const savingCat = n => /적금|청약|예금/.test(n) ? '적금·청약' : /연금|IRP|ISA/i.test(n) ? '연금' : /코인|업비트|비트/.test(n) ? '코인' : (/주식|ETF|증권|투자|미래에셋|S&P|나스닥|KODEX|TIGER|ACE|SOL|모으기/i.test(n) || /^[A-Z]{2,5}\b/.test(n.trim())) ? '주식·ETF' : '기타투자';
function fixedItemsFrom(list) {
  return list.map(it => {
    if (it.kind === 'saving') it = { ...it, type: 'saving', category: SAVING_CATS.includes(it.category) ? it.category : savingCat(it.name) };
    // 중복: 이름이 같거나, 같은 종류·카테고리에서 금액·날짜가 같을 때 (종류가 다르면 우연히 금액이 같아도 별개)
    const dup = state.fixed.some(f => normName(f.name) === normName(it.name) ||
      (f.type === it.type && f.category === it.category && f.amount === it.amount && String(f.day) === String(it.day)));
    const off = it.kind === 'card' || (it.type === 'income' && it.amount < 1000); // 카드대금(이중 계산)·분기 이자 몇십 원은 기본 제외
    return { ...it, dup, on: !dup && !off };
  });
}

function renderFixedPreview() {
  const box = form.querySelector('#fixedPreview');
  if (!fixedItems.length) {
    box.innerHTML = form.querySelector('textarea').value.trim() ? `<div class="empty">인식 실패</div>` : '';
    return;
  }
  const on = fixedItems.filter(x => x.on);
  const tot = t => sum(on.filter(x => x.type === t));
  box.innerHTML = `<div class="muted" style="margin:14px 0 6px">${fixedItems.length}건 · 수입 ${won(tot('income'))} · 지출 ${won(tot('expense'))}</div>
    ${fixedItems.some(x => x.kind === 'card') ? `<div class="hint">카드대금 제외 (중복)</div>` : ''}
    ${fixedItems.some(x => x.kind === 'installment') ? '' : ''}
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
      <div class="row"><h2>목표</h2><button class="btn sm" data-add-goal>＋</button></div>
      <div class="row"><span class="muted">월 저축 여력</span><b>${won(avg.net)}</b></div>
    </section>
    ${state.goals.length ? state.goals.map(g => goalCard(g, avg)).join('') : `<section class="card"><div class="empty">목표 없음</div></section>`}
  `;
}

function goalCard(g, avg) {
  const p = goalPlan(g, avg);
  const ok = p.shortfall <= 0;
  const eta = p.etaMonths === Infinity ? '도달 불가' : `${shiftMonth(ym(new Date()), p.etaMonths).replace('-', '.')}`;
  let advice = '';
  if (ok) {
    advice = `<div class="tip good"><b>✓ 달성 가능</b></div>`;
  } else {
    advice = `<div class="tip warn"><b>월 ${won(p.shortfall)} 부족</b></div>`;
    if (p.cuts.length) {
      advice += `<h3>줄일 곳</h3>
        <table class="mini">${p.cuts.map(c => `<tr><td>${esc(c.category)}</td><td>−${won(c.cut)}</td></tr>`).join('')}</table>`;
    }
    if (!p.cutsCover) {
      advice += `<div class="hint">그래도 월 ${won(p.remainingAfterCuts)} 부족 → 기한·금액 조정</div>`;
    }
  }
  const horizon = p.months <= 12 ? '예·적금'
    : p.months <= 36 ? '예금·채권 위주'
    : '일부 분산 ETF';
  return `<section class="card">
    <div class="row"><h2>${esc(g.name)}</h2><button class="link-btn" data-edit-goal="${g.id}">수정</button></div>
    <div class="row"><span class="big">${shortWon(g.saved)}</span><span class="muted">/ ${won(g.target)}</span></div>
    <div class="bar ${ok ? '' : 'over'}"><i style="width:${Math.min(100, p.progress)}%"></i></div>
    <table class="mini" style="margin-top:10px">
      <tr><td>기한</td><td>${g.deadline.replace('-', '.')} · ${p.months}개월</td></tr>
      <tr><td>수익률</td><td>${g.rate}%</td></tr>
      <tr><td>월 필요</td><td><b>${won(p.need)}</b></td></tr>
      <tr><td>예상 도달</td><td>${eta}</td></tr>
    </table>
    ${advice}
    <div class="muted" style="margin-top:8px">💡 ${horizon}</div>
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
    ${coachHtml()}
    ${accountCardHtml()}
    <section class="card">
      <h2>절약</h2>
      ${tips.length ? tips.map(t => `<details class="tip ${t.level || ''}"><summary>${esc(t.title)}</summary><div>${t.body}</div></details>`).join('') : `<div class="empty">기록 쌓이는 중</div>`}
    </section>

    <section class="card">
      <h2>투자 순서</h2>
      <ol class="ladder">
        <li class="${st.highDebt ? '' : 'done'}">고금리 빚 상환 ${st.highDebt ? '<span class="pill bad">해당</span>' : '<span class="pill ok">없음</span>'}</li>
        <li class="${efOk ? 'done' : ''}">비상금 ${shortWon(efTarget)}원 ${efOk ? '<span class="pill ok">충족</span>' : '<span class="pill bad">부족</span>'}</li>
        <li>연금저축 · IRP · ISA</li>
        <li>분산 ETF 적립</li>
        <li>개별주·코인은 소액만</li>
      </ol>
    </section>

    <section class="card">
      <h2>내 상태</h2>
      <label>비상금</label>
      <input id="setEmergency" inputmode="numeric" value="${st.emergency ? st.emergency.toLocaleString('ko-KR') : ''}" placeholder="0" />
      <label style="display:flex;align-items:center;gap:8px;color:var(--text)"><input type="checkbox" id="setDebt" style="width:auto" ${st.highDebt ? 'checked' : ''}/> 고금리 빚 있음</label>
    </section>

    <section class="card">
      <h2>데이터</h2>
      <div class="actions">
        <button class="btn ghost" id="exportBtn">백업</button>
        <button class="btn ghost" id="importBtn">복원</button>
      </div>
      <input type="file" id="importFile" accept="application/json,.json" hidden />
      <div class="actions"><button class="btn ghost" id="updateBtn">업데이트</button><button class="btn danger" id="resetBtn">초기화</button></div>
    </section>
  `;
}

/* ===================== AI 재무 코치 ===================== */
// 보내는 데이터: 집계값과 항목 이름·금액만(내역 메모·계좌·실명 없음)
function coachSnapshot() {
  const now = ym(new Date());
  const act = activeFixed(now);
  const pick = f => ({ name: f.name, category: f.category, amount: f.amount, ...(f.day ? { day: f.day } : {}), ...(f.until ? { until: f.until } : {}) });
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(now, -i)).reverse().map(m => {
    const s = monthStats(m);
    const top = Object.entries(s.byCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { month: m, income: s.income, expense: s.expense, investAndSaving: s.saving, leftover: s.left, basis: s.actual ? '실제 기록' : '고정 항목+기록', topVariable: Object.fromEntries(top) };
  });
  return {
    today: todayStr(),
    fixedIncome: act.filter(f => f.type === 'income').map(pick),
    fixedExpenses: act.filter(f => f.type === 'expense' && !f.until && f.category !== '보험').map(pick),
    insurance: act.filter(f => f.type === 'expense' && f.category === '보험').map(pick),
    installments: act.filter(f => f.type === 'expense' && f.until).map(pick),
    utilities: (state.bills || []).map(b => ({ name: b.name, type: b.cat, recentAvg: billAvg(b), thisMonth: billAmount(b, now).v })),
    investmentsMonthly: act.filter(f => f.type === 'saving').map(pick),
    goals: state.goals.map(g => ({ name: g.name, target: g.target, saved: g.saved, deadline: g.deadline, assumedReturnPct: g.rate })),
    emergencyFundCash: state.settings.emergency || 0,
    highInterestDebt: !!state.settings.highDebt,
    months,
    notes: '투자는 지출이 아님(저축으로 간주). leftover = 수입 − 지출 − 투자. 카드로 그때그때 쓰는 변동지출은 기록이 쌓이는 중이라 최근 달은 과소 집계일 수 있음.',
  };
}

function coachHtml() {
  const a = state.settings.aiAdvice;
  if (coachBusy) return `<section class="card" id="coachCard"><h2>🧠 AI 코치</h2><div class="empty">분석 중… 최대 1~2분</div></section>`;
  if (!a) return `<section class="card" id="coachCard"><div class="row"><h2>🧠 AI 코치</h2><button class="btn sm" id="coachBtn">진단</button></div></section>`;
  const d = a.data, when = new Date(a.at);
  return `<section class="card" id="coachCard">
    <div class="row"><h2>🧠 AI 코치</h2><button class="link-btn" id="coachBtn">↻ ${when.getMonth() + 1}/${when.getDate()}</button></div>
    <div class="coach-top"><div class="score" style="--p:${Math.max(0, Math.min(100, d.score))}"><b>${d.score}</b></div><p>${esc(d.summary)}</p></div>
    <div class="tip ${d.goal?.etaMonths ? 'good' : 'warn'}"><b>🎯 월 ${won(d.goal?.monthlyNeeded || 0)}${d.goal?.etaMonths ? ` · ${d.goal.etaMonths}개월` : ''}</b>${esc(d.goal?.verdict || '')}</div>
    ${(d.actions || []).sort((x, y) => x.priority - y.priority).map((x, i) => `
      <details class="tip act"><summary><span><span class="pill">${esc(x.area)}</span> ${i + 1}. ${esc(x.title)}</span>${x.monthlyImpact ? `<span class="income">+${shortWon(x.monthlyImpact)}</span>` : ''}</summary>
        <div><b>왜</b> ${esc(x.why)}</div><div><b>어떻게</b> ${esc(x.how)}</div></details>`).join('')}
    ${(d.warnings || []).map(w => `<div class="hint">⚠ ${esc(w)}</div>`).join('')}
    <div class="hint">AI 판단 · 세율·한도는 가입 전 확인</div>
  </section>`;
}
let coachBusy = false;
async function runCoach() {
  if (!window.EokAI?.consent()) return;
  coachBusy = true; refreshCoach();
  try {
    const data = await EokAI.advise(coachSnapshot());
    state.settings.aiAdvice = { at: Date.now(), data };
    save();
  } catch (e) { toast(e.message || 'AI 실패'); }
  coachBusy = false; refreshCoach();
}
function refreshCoach() { const el = document.getElementById('coachCard'); if (el) el.outerHTML = coachHtml(); }

function accountCardHtml() {
  const st = window.EokSync?.status() || { phase: 'loading' };
  const time = st.last ? new Date(st.last).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';
  let body;
  if (st.phase === 'noconfig') body = `<p class="muted">기기 저장</p>`;
  else if (st.phase === 'loading') body = `<p class="muted">…</p>`;
  else if (st.phase === 'offline') body = `<p class="muted">오프라인</p>`;
  else if (st.phase === 'error') body = `<p class="muted">${esc(st.error)}</p>`;
  else if (!st.user) body = `<button class="btn block" id="loginBtn">Google 로그인</button>`;
  else body = `<div class="row"><div><div class="title">${esc(st.user.name || '')}</div><div class="muted">${esc(st.user.email || '')}</div></div>
      <button class="link-btn" id="logoutBtn">로그아웃</button></div>
      <div class="row" style="margin-top:8px"><span class="muted">${st.phase === 'syncing' ? '☁ …' : time ? `☁ ${time}` : '☁'}</span>
      <button class="btn sm ghost" id="syncBtn">↻</button></div>
      <h3>자동 수집</h3>
      <div id="dropBox">${dropHtml()}</div>`;
  return `<section class="card" id="accountCard"><h2>계정</h2>${body}${st.error && st.user ? `<div class="hint">⚠ ${esc(st.error)}</div>` : ''}</section>`;
}
let dropShown = null; // 자동 수집 설정값(한 번 불러오면 카드 다시 그려도 유지)
function dropHtml() {
  if (!dropShown) return '<button class="btn sm ghost" id="dropBtn">설정</button>';
  if (dropShown.error) return `<p class="muted">⚠ ${esc(dropShown.error)}</p><button class="btn sm ghost" id="dropBtn">↻</button>`;
  if (dropShown.loading) return '<p class="muted">…</p>';
  const body = `{"fields":{"text":{"stringValue":"[notification_title] [notification]"},"key":{"stringValue":"${dropShown.key}"}}}`;
  return `
    <label>URL (POST)</label><div class="codebox" id="dropUrl">${esc(dropShown.url)}</div><button class="link-btn" data-copy="dropUrl">복사</button>
    <label>Body (JSON)</label><div class="codebox" id="dropBody">${esc(body)}</div><button class="link-btn" data-copy="dropBody">복사</button>
    <p class="hint">🔒 공유 금지</p>`;
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
    if (it.billId && recordBill(it)) { added++; continue; }
    state.tx.push({ id: uid(), type: it.type, amount: it.amount, category: it.category, memo: it.memo.trim(), date: it.date, auto: true });
    added++;
  }
  if (added || removed) { save(); if (!sheet.open) render(); }
  toast(`자동 ${added}건 등록${removed ? ` · 취소 ${removed}` : ''}`);
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

  // 공과금이 평소(최근 기록 평균)보다 25% 이상 많을 때
  for (const b of state.bills || []) {
    const m = ym(new Date()), v = b.rec?.[m], avgB = billAvg(b, m);
    if (v && avgB && v > avgB * 1.25) tips.push({ level: 'warn', title: `${BILL_ICON[b.cat] || ''} ${b.name} +${pct(v - avgB, avgB)}%`, body: `평소 ${won(avgB)} → 이번 달 ${won(v)}` });
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
  // 이미 다른 칸을 누르고 입력 중이면 커서를 뺏지 않는다(뺏으면 입력이 금액 칸으로 들어감)
  if (first && !first.value) setTimeout(() => { if (!form.contains(document.activeElement) || document.activeElement === form) first.focus(); }, 50);
}

const catOptions = (type, selected) =>
  (type === 'income' ? INCOME_CATS : type === 'saving' ? SAVING_CATS : EXPENSE_CATS).map(c => `<option ${c === selected ? 'selected' : ''}>${c}</option>`).join('');
const typeSeg = type => `<div class="seg">
    <input type="radio" name="type" id="tExp" value="expense" ${type === 'expense' ? 'checked' : ''}><label for="tExp">지출</label>
    <input type="radio" name="type" id="tInc" value="income" ${type === 'income' ? 'checked' : ''}><label for="tInc">수입</label>
  </div>`;
const typeSeg3 = type => `<div class="seg seg3">
    <input type="radio" name="type" id="tExp" value="expense" ${type === 'expense' ? 'checked' : ''}><label for="tExp">지출</label>
    <input type="radio" name="type" id="tInc" value="income" ${type === 'income' ? 'checked' : ''}><label for="tInc">수입</label>
    <input type="radio" name="type" id="tSav" value="saving" ${type === 'saving' ? 'checked' : ''}><label for="tSav">투자</label>
  </div>`;
const moneyVal = n => (n ? Number(n).toLocaleString('ko-KR') : '');

function openTxSheet(t) {
  const isNew = !t;
  t = t || { type: 'expense', amount: '', category: '식비', memo: '', date: selectedDay || (viewMonth === ym(new Date()) ? todayStr() : viewMonth + '-01') };
  openSheet(`<div class="row"><h2>${isNew ? '내역 추가' : '내역 수정'}</h2>${isNew ? '<button type="button" class="link-btn" data-act="sms">✉ 문자</button>' : ''}</div>
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

function openFixedSheet(f, type, cat) {
  const isNew = !f;
  f = f || { type: type || 'expense', name: '', amount: '', category: cat || (type === 'income' ? '급여' : type === 'saving' ? '주식·ETF' : '주거/관리비'), day: '' };
  openSheet(`<h2>${isNew ? '고정 항목 추가' : '고정 항목 수정'}</h2>
    ${typeSeg3(f.type)}
    <label>이름</label><input name="name" required value="${esc(f.name)}" placeholder="예: 월세, 넷플릭스, 월급" maxlength="30" />
    <label>월 금액</label><input name="amount" data-money inputmode="numeric" required value="${moneyVal(f.amount)}" placeholder="0" />
    <label>카테고리</label><select name="category">${catOptions(f.type, f.category)}</select>
    <label>매월 (일)</label><input name="day" type="number" min="1" max="31" value="${f.day || ''}" />
    <label>종료 월</label><input name="until" type="month" value="${f.until || ''}" />`,
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
    <label>연수익률 %</label><input name="rate" type="number" step="0.1" min="0" max="20" value="${g.rate}" />
    <div class="hint">예금 2~3 · 주식 4~6</div>`,
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
  openSheet(`<h2>✉ 문자·카톡</h2>
    <div class="row" style="margin-bottom:8px">
      <span><button type="button" class="btn sm ghost" data-act="clip">📋 붙여넣기</button> <button type="button" class="btn sm ghost" data-act="ai">✨ AI</button></span>
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
  form.querySelector('[data-act=ai]').onclick = async e => {
    if (!ta.value.trim() || !window.EokAI?.consent()) return;
    const btn = e.target; btn.disabled = true; btn.textContent = '✨ …';
    try { buildSmsItems.skipped = 0; smsItems = smsItemsFrom(await EokAI.parseNotifications(ta.value, EXPENSE_CATS, INCOME_CATS)); renderSmsPreview(); toast(`AI ${smsItems.length}건`); }
    catch (err) { toast(err.message || 'AI 실패'); }
    finally { btn.disabled = false; btn.textContent = '✨ AI'; }
  };
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
  return smsItemsFrom(results);
}
function smsItemsFrom(results) {
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
    const bill = type === 'expense' ? billMatch(memo) : null;
    return { type, amount: r.amount, date: r.date, memo, category, dup, fixedHit: fixedHit ? fixedHit.name : '', billId: bill?.id || '', billName: bill?.name || '', cancelTarget,
      on: type === 'cancel' ? !!cancelTarget : !dup && (!fixedHit || !!bill) };
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
    box.innerHTML = form.querySelector('textarea').value.trim() ? `<div class="empty">인식 실패</div>` : '';
    form.querySelector('button[type=submit]').textContent = saveLabel();
    return;
  }
  box.innerHTML = `<div class="muted" style="margin:14px 0 6px">${smsItems.length}건${sk ? ` · 제외 ${sk}` : ''}</div>
    ${smsItems.map((it, i) => `
    <div class="sms-item ${it.on ? '' : 'off'}" data-i="${i}">
      <div class="row">
        <label class="chk"><input type="checkbox" data-f="on" ${it.on ? 'checked' : ''}>
          <span class="pill ${it.type === 'income' ? 'ok' : it.type === 'cancel' ? 'bad' : ''}">${it.type === 'income' ? '수입' : it.type === 'cancel' ? '취소' : '지출'}</span>
          ${it.dup ? '<span class="pill bad">이미 있음?</span>' : ''}${it.billId ? '<span class="pill ok">공과금</span>' : it.fixedHit ? '<span class="pill bad">고정 항목</span>' : ''}</label>
        <input class="amt ${it.type}" data-f="amount" inputmode="numeric" value="${moneyVal(it.amount)}">
      </div>
      ${it.billId ? `<div class="hint">→ ${esc(it.billName)} ${Number(it.date.slice(5, 7))}월</div>` : it.fixedHit ? `<div class="hint">= ${esc(it.fixedHit)}</div>` : ''}
      ${it.type === 'cancel'
        ? `<div class="hint">${it.cancelTarget ? '원 결제 삭제' : '원 결제 없음'}</div>`
        : `<div class="sms-fields">
            <input data-f="memo" value="${esc(it.memo)}" maxlength="40">
            <select data-f="category">${catOptions(it.type, it.category)}</select>
            <input data-f="date" type="date" value="${it.date}">
          </div>`}
    </div>`).join('')}`;
  form.querySelector('button[type=submit]').textContent = saveLabel();
}

// 공과금 결제 → 그 달 공과금 기록(+납부 체크). 내역에는 넣지 않음(이중 계산 방지)
function recordBill(it) {
  const b = state.bills.find(x => x.id === it.billId); if (!b) return false;
  const m = it.date.slice(0, 7);
  b.rec = { ...(b.rec || {}), [m]: it.amount }; b.paid = { ...(b.paid || {}), [m]: true };
  return true;
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
    if (it.billId && recordBill(it)) { added++; continue; }
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



/* ===================== 공과금 ===================== */
// 매달 금액이 달라지는 청구서(전기·가스·수도·관리비 등). 월별 기록(rec)과 납부 여부(paid)를 따로 관리.
const BILL_CATS = ['전기', '가스', '수도', '관리비', '인터넷·TV', '기타'];
const BILL_ICON = { 전기: '⚡', 가스: '🔥', 수도: '💧', 관리비: '🏢', '인터넷·TV': '📶', 교통: '🚇', 기타: '🧾' };
const BILL_KEY = { 전기: /한전|한국전력|전기/, 가스: /가스/, 수도: /수도|상하수도/, 관리비: /관리비|관리사무소|아파트/, '인터넷·TV': /인터넷|IPTV|수신료/, 기타: /$^/ };
let fixedMode = 'fixed'; // 'fixed' | 'bills'

// 그 달 금액: 기록이 있으면 기록, 없고 이번 달 이후면 가장 최근 기록으로 추정, 지난 달이면 0
function billAmount(b, m) {
  if (b.rec?.[m] != null) return { v: b.rec[m], est: false };
  if (m < ym(new Date())) return { v: 0, est: false };
  const last = Object.keys(b.rec || {}).filter(k => k < m).sort().pop();
  return { v: last ? b.rec[last] : 0, est: !!last };
}
const billsTotal = m => (state.bills || []).reduce((a, b) => a + billAmount(b, m).v, 0);
function billAvg(b, before) {
  const ks = Object.keys(b.rec || {}).filter(k => !before || k < before).sort().slice(-6);
  return ks.length ? Math.round(ks.reduce((a, k) => a + b.rec[k], 0) / ks.length) : 0;
}
const billMatch = memo => (state.bills || []).find(b => normName(memo).includes(normName(b.name)) || BILL_KEY[b.cat]?.test(memo));
const billCandidates = () => state.fixed.filter(f => f.type === 'expense' && !f.until && /가스|전기|한전|수도|관리비|관리/.test(f.name));

function renderBills() {
  const now = ym(new Date()), prev = shiftMonth(now, -1);
  const bills = state.bills || [];
  const tot = billsTotal(now), totPrev = billsTotal(prev);
  const anyEst = bills.some(b => billAmount(b, now).est);
  const cands = billCandidates();
  view.innerHTML = `
    ${fixedSeg()}
    <section class="card">
      <div class="muted">이번 달 공과금${anyEst ? ' · 추정 포함' : ''}</div>
      <div class="big expense">${won(tot)}</div>
      ${totPrev ? `<div class="muted">지난달 ${won(totPrev)} ${tot >= totPrev ? '▲' : '▼'} ${won(Math.abs(tot - totPrev))}</div>` : ''}
    </section>
    ${cands.length ? `<button class="sms-cta" data-bill-migrate><span class="cat-ic" style="--c:var(--gold)">⇄</span><span><b>고정에서 옮기기 ${cands.length}</b><small>${cands.map(f => esc(f.name)).join(' · ')}</small></span><span class="chev">›</span></button>` : ''}
    <button class="sms-cta" data-bill-import><span class="cat-ic" style="--c:var(--gold)">⇣</span><span><b>공과금 붙여넣기</b></span><span class="chev">›</span></button>
    <section class="card">
      <div class="row"><h2>공과금 <span class="h-sum expense">${won(tot)}</span></h2><button class="btn sm ghost" data-add-bill>＋</button></div>
      ${bills.length ? `<ul class="list">${bills.map(b => {
        const a = billAmount(b, now), p = billAmount(b, prev).v, avg = billAvg(b);
        const diff = !a.est && p ? Math.round((a.v - p) / p * 100) : null;
        return `<li data-bill="${b.id}">
          <div class="li-main"><span class="cat-ic bill-ic">${BILL_ICON[b.cat] || '🧾'}</span>
            <div><div class="title">${esc(b.name)}</div><div class="sub">${b.day ? `${b.day}일` : ''}${avg ? `${b.day ? ' · ' : ''}평균 ${shortWon(avg)}` : ''}</div></div></div>
          <div class="bill-right">
            <div class="amount ${a.est ? 'muted' : 'expense'}">${a.v ? won(a.v) : '–'}${a.est ? '<small> 추정</small>' : ''}</div>
            <div class="sub">${diff != null ? `<span class="${diff > 0 ? 'expense' : 'income'}">${diff > 0 ? '▲' : '▼'}${Math.abs(diff)}%</span>` : ''}
              <button class="paid ${b.paid?.[now] ? 'on' : ''}" data-bill-paid="${b.id}">${b.paid?.[now] ? '✓ 납부' : '미납'}</button></div>
          </div></li>`;
      }).join('')}</ul>` : `<div class="empty">없음</div>`}
    </section>`;
}
const fixedSeg = () => `<div class="seg view-seg">
    <input type="radio" name="fxmode" id="fxF" value="fixed" ${fixedMode === 'fixed' ? 'checked' : ''}><label for="fxF">고정</label>
    <input type="radio" name="fxmode" id="fxB" value="bills" ${fixedMode === 'bills' ? 'checked' : ''}><label for="fxB">공과금</label>
  </div>`;

function openBillSheet(b) {
  const isNew = !b;
  b = b || { name: '', cat: '전기', day: '', rec: {}, paid: {} };
  const now = ym(new Date());
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(now, -i));
  const max = Math.max(1, ...months.map(m => b.rec?.[m] || 0));
  openSheet(`<h2>${isNew ? '공과금 추가' : esc(b.name)}</h2>
    <div class="grid2">
      <div><label>이름</label><input name="name" required value="${esc(b.name)}" placeholder="예: 전기요금" maxlength="20"></div>
      <div><label>종류</label><select name="cat">${BILL_CATS.map(c => `<option ${c === b.cat ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    </div>
    <div class="grid2">
      <div><label>월</label><input name="month" type="month" value="${now}"></div>
      <div><label>금액</label><input name="amount" data-money inputmode="numeric" value="${moneyVal(b.rec?.[now])}" placeholder="0"></div>
    </div>
    <label>납부일</label><input name="day" type="number" min="1" max="31" value="${b.day || ''}">
    ${isNew ? '' : `<h3>최근 12개월 · 평균 ${won(billAvg(b))}</h3>
      <div class="bill-hist">${months.slice().reverse().map(m => `
        <button type="button" class="bh ${b.rec?.[m] != null ? '' : 'empty'}" data-bh="${m}" title="${m}">
          <i style="height:${Math.round((b.rec?.[m] || 0) / max * 100)}%"></i><span>${Number(m.slice(5))}</span></button>`).join('')}</div>`}`,
    fd => {
      if (!fd.name.trim()) { alert('이름을 입력하세요'); return false; }
      const amt = parseAmount(fd.amount);
      const rec = { ...(b.rec || {}) };
      if (fd.month) { if (amt) rec[fd.month] = amt; else delete rec[fd.month]; }
      const nb = { id: b.id || uid(), name: fd.name.trim(), cat: fd.cat, day: Number(fd.day) || '', rec, paid: { ...(b.paid || {}) } };
      state.bills = state.bills || [];
      if (isNew) state.bills.push(nb); else state.bills[state.bills.findIndex(x => x.id === b.id)] = nb;
    },
    isNew ? null : () => { state.bills = state.bills.filter(x => x.id !== b.id); });
  // 막대 누르면 그 달 금액을 불러와 수정
  form.querySelectorAll('[data-bh]').forEach(btn => btn.onclick = () => {
    const m = btn.dataset.bh;
    form.querySelector('[name=month]').value = m;
    form.querySelector('[name=amount]').value = moneyVal(b.rec?.[m]);
  });
  form.querySelector('[name=month]').addEventListener('change', e => { form.querySelector('[name=amount]').value = moneyVal(b.rec?.[e.target.value]); });
}


// 공과금 목록 붙여넣기: "| 이름 | 종류 | 납부일 | 월 | 금액 |" 표나 "전기요금 2026-09 78,700원" 줄을 월별 기록으로
function parseBillList(text, maxAmount = 5e6) {
  const now = new Date(), out = new Map();
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || /^\|?\s*:?-{2,}/.test(line) || /^#/.test(line)) continue;
    const cells = line.includes('|') ? line.replace(/^\||\|$/g, '').split('|').map(c => c.replace(/\*\*/g, '').trim())
      : line.includes('\t') ? line.split('\t').map(c => c.trim()) : null;
    const all = cells ? cells.join(' ') : line;
    let mm = all.match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*월?/), y, m;
    if (mm) { y = +mm[1]; m = +mm[2]; }
    else if ((mm = all.match(/(\d{1,2})\s*월/))) { m = +mm[1]; y = now.getFullYear(); if (m > now.getMonth() + 1) y--; }
    if (!m || m < 1 || m > 12) continue;
    const amtCell = cells ? cells.find(c => /원|₩|^\d{1,3}(,\d{3})+$/.test(c) && !/월$/.test(c)) : line.replace(mm[0], ' '); // 날짜 숫자가 금액에 붙지 않게
    const amount = amtCell ? SmsParser.parseKoreanAmount(amtCell) : 0;
    if (!amount || amount > maxAmount) continue;
    // 이름 = 날짜·금액·납부일·구분(수입/지출/투자) 칸이 아닌 첫 칸
    let name = cells ? cells.find(c => c && !/\d{4}[.\-/년]|^\d{1,2}\s*월$|원|₩|^\d+일$|^\d[\d,]*$|^(수입|지출|투자|저축|구분)$/.test(c)) : line.split(/\s*\d/)[0];
    name = String(name || '').replace(/\s*\([^)]*\)/g, '').trim();
    if (!name || /^(이름|항목|종류|구분|합계|월|금액)/.test(name)) continue;
    const cat = (cells && cells.find(c => BILL_CATS.includes(c))) || Object.keys(BILL_KEY).find(k => BILL_KEY[k].test(all)) || '기타';
    const dm = cells ? cells.map(c => c.match(/^(\d{1,2})\s*일$/)).find(Boolean) : null;
    const key = normName(name);
    const b = out.get(key) || { name, cat, day: '', rec: {} };
    if (dm && !b.day) b.day = +dm[1];
    b.rec[`${y}-${String(m).padStart(2, '0')}`] = amount;
    out.set(key, b);
  }
  return [...out.values()];
}

function openBillImportSheet(initialText = '') {
  let found = [];
  openSheet(`<h2>공과금 붙여넣기</h2>
    <div class="row" style="margin-bottom:8px"><button type="button" class="btn sm ghost" data-act="clip">📋 붙여넣기</button><button type="button" class="link-btn" data-act="clear">지우기</button></div>
    <textarea name="billText" rows="6" placeholder="| 이름 | 종류 | 납부일 | 월 | 금액 |&#10;| 전기요금 | 전기 | 17일 | 2026-09 | 78,700원 |"></textarea>
    <div id="billPreview"></div>`,
    () => {
      if (!found.length) { alert('인식된 항목이 없어요'); return false; }
      state.bills = state.bills || [];
      let nb = 0, nr = 0;
      for (const f of found) {
        const ex = state.bills.find(b => normName(b.name) === normName(f.name));
        const paid = Object.fromEntries(Object.keys(f.rec).filter(m => m <= ym(new Date())).map(m => [m, true])); // 실제 결제 기록이므로 납부
        if (ex) { ex.rec = { ...(ex.rec || {}), ...f.rec }; ex.paid = { ...(ex.paid || {}), ...paid }; if (!ex.day && f.day) ex.day = f.day; }
        else { state.bills.push({ id: uid(), name: f.name, cat: f.cat, day: f.day, rec: f.rec, paid }); nb++; }
        nr += Object.keys(f.rec).length;
      }
      setTimeout(() => toast(`공과금 ${nb ? `${nb}개 추가 · ` : ''}기록 ${nr}건`), 100);
    });
  const ta = form.querySelector('textarea'), submit = form.querySelector('button[type=submit]'), box = form.querySelector('#billPreview');
  const update = () => {
    found = parseBillList(ta.value);
    submit.textContent = found.length ? `${found.length}개 등록` : '등록';
    box.innerHTML = found.length ? `<ul class="list">${found.map(f => {
      const ex = (state.bills || []).some(b => normName(b.name) === normName(f.name));
      const ms = Object.keys(f.rec).sort();
      return `<li><div class="li-main"><span class="cat-ic bill-ic">${BILL_ICON[f.cat] || '🧾'}</span><div><div class="title">${esc(f.name)} ${ex ? '<span class="pill">기존</span>' : ''}</div>
        <div class="sub">${ms.map(m => `${Number(m.slice(5))}월 ${shortWon(f.rec[m])}`).join(' · ')}</div></div></div></li>`;
    }).join('')}</ul>` : (ta.value.trim() ? '<div class="empty">인식 실패</div>' : '');
  };
  ta.addEventListener('input', update);
  form.querySelector('[data-act=clear]').onclick = () => { ta.value = ''; update(); };
  form.querySelector('[data-act=clip]').onclick = async () => { try { ta.value = await navigator.clipboard.readText(); update(); } catch { ta.focus(); } };
  if (initialText) { ta.value = initialText; update(); }
}

// 과거 월 합계 → 내역(예: 주유·지하철·택시 월별 합계). 이번 달은 결제 문자로 건별 기록되므로 제외(이중 계산 방지)
function openMonthSumSheet(initialText = '') {
  let rows = [];
  const cur = ym(new Date());
  openSheet(`<h2>월 합계 붙여넣기</h2>
    <div class="row" style="margin-bottom:8px"><button type="button" class="btn sm ghost" data-act="clip">📋 붙여넣기</button><button type="button" class="link-btn" data-act="clear">지우기</button></div>
    <textarea name="sumText" rows="6" placeholder="| 항목 | 카테고리 | 월 | 금액 |&#10;| 주유 | 교통 | 2026-10 | 120,000원 |"></textarea>
    <div id="sumPreview"></div>`,
    () => {
      if (!rows.length) { alert('인식된 항목이 없어요'); return false; }
      for (const r of rows) {
        const memo = `${r.name} (월합계)`;
        state.tx = state.tx.filter(t => !(t.memo === memo && t.date.startsWith(r.m))); // 같은 월 합계는 덮어쓰기
        state.tx.push({ id: uid(), type: r.type, amount: r.amount, category: r.cat, memo, date: `${r.m}-28`, sum: true });
      }
      setTimeout(() => toast(`월 합계 ${rows.length}건`), 100);
    });
  const ta = form.querySelector('textarea'), submit = form.querySelector('button[type=submit]'), box = form.querySelector('#sumPreview');
  const update = () => {
    const parsed = parseBillList(ta.value, 1e10);
    rows = [];
    let skipped = 0;
    const lines = ta.value.split('\n');
    for (const p of parsed) for (const [m, amount] of Object.entries(p.rec)) {
      if (m >= cur) { skipped++; continue; }
      const ln = lines.filter(l => l.includes(p.name)).join(' ');
      const type = /\|\s*수입\s*\||^수입\b/.test(ln) ? 'income' : /\|\s*(투자|저축)\s*\||^(투자|저축)\b/.test(ln) ? 'saving' : 'expense';
      const cats = type === 'income' ? INCOME_CATS : type === 'saving' ? SAVING_CATS : EXPENSE_CATS;
      let cat = cats.find(c => ln.includes(c));
      if (!cat) cat = type === 'income' ? '기타' : type === 'saving' ? savingCat(p.name) : (/주유|기름|지하철|버스|택시|교통|후불/.test(p.name) ? '교통' : SmsParser.guessCategory('expense', p.name, p.name));
      rows.push({ name: p.name, m, amount, cat, type });
    }
    rows.sort((a, b) => a.m.localeCompare(b.m) || a.name.localeCompare(b.name));
    submit.textContent = rows.length ? `${rows.length}건 등록` : '등록';
    box.innerHTML = rows.length ? `${skipped ? `<div class="hint">이번 달 ${skipped}건 제외 (문자로 기록)</div>` : ''}<table class="mini">${rows.map(r =>
      `<tr><td>${Number(r.m.slice(5))}월 · ${esc(r.name)} <span class="muted">${r.type === 'income' ? '수입' : r.type === 'saving' ? '투자' : ''} ${esc(r.cat)}</span></td><td class="${r.type === 'income' ? 'income' : ''}">${r.type === 'expense' ? '−' : '+'}${won(r.amount)}</td></tr>`).join('')}</table>` : (ta.value.trim() ? '<div class="empty">인식 실패</div>' : '');
  };
  ta.addEventListener('input', update);
  form.querySelector('[data-act=clear]').onclick = () => { ta.value = ''; update(); };
  form.querySelector('[data-act=clip]').onclick = async () => { try { ta.value = await navigator.clipboard.readText(); update(); } catch { ta.focus(); } };
  if (initialText) { ta.value = initialText; update(); }
}

function migrateBills() {
  const cands = billCandidates();
  if (!cands.length || !confirm(`${cands.map(f => f.name).join(', ')}\n공과금으로 옮길까요?`)) return;
  const now = ym(new Date());
  state.bills = state.bills || [];
  for (const f of cands) {
    const cat = /전기|한전/.test(f.name) ? '전기' : /가스/.test(f.name) ? '가스' : /수도/.test(f.name) ? '수도' : '관리비';
    state.bills.push({ id: uid(), name: f.name, cat, day: f.day || '', rec: { [now]: f.amount }, paid: {} });
  }
  const ids = new Set(cands.map(f => f.id));
  state.fixed = state.fixed.filter(f => !ids.has(f.id));
  save(); render(); toast(`공과금 ${cands.length}건`);
}

/* ===================== 연간 보기 + 월/연 선택 ===================== */
// 기록 시작 월: 첫 거래 월과 고정 항목을 처음 저장한 월 중 이른 쪽.
// (고정 항목은 시작일이 없어 모든 달에 적용되므로, 그 이전 달은 연간 합계에서 제외해야 가짜 숫자가 안 생김)
function startMonth() {
  const c = [];
  for (const t of state.tx) if (t.date) c.push(t.date.slice(0, 7));
  for (const f of state.fixed) if (f.u) c.push(ym(new Date(f.u)));
  return c.length ? c.sort()[0] : ym(new Date());
}
function yearStats(y) {
  const now = ym(new Date()), start = startMonth();
  const months = Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`).map(m => {
    const s = monthStats(m);
    return { ...s, counted: m >= start && m <= now, future: m > now };
  });
  const cm = months.filter(m => m.counted);
  const add = k => cm.reduce((a, m) => a + m[k], 0);
  const byCat = {};
  cm.forEach(m => Object.entries(m.byCat).forEach(([k, v]) => { byCat[k] = (byCat[k] || 0) + v; }));
  return { y, months, counted: cm, income: add('income'), expense: add('expense'), fixedExpense: add('fixedExpense'),
    varExpense: add('varExpense'), net: add('net'), saving: add('saving'), left: add('left'), byCat };
}
const yearRange = ys => ys.counted.length ? (ys.counted.length === 1 ? `${Number(ys.counted[0].m.slice(5))}월` : `${Number(ys.counted[0].m.slice(5))}~${Number(ys.counted.at(-1).m.slice(5))}월`) : '기록 없음';

function renderYearHome() {
  const ys = yearStats(Number(viewMonth.slice(0, 4)));
  const rate = ys.income > 0 ? Math.round((ys.net / ys.income) * 100) : 0;
  const cats = Object.entries(ys.byCat).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...ys.months.map(m => Math.max(m.income, m.expense)));
  view.innerHTML = `
    <section class="hero">
      <div class="hero-label">${ys.y}년 · ${yearRange(ys)}</div>
      <div class="hero-amount ${ys.left < 0 ? 'neg' : ''}">${won(ys.left)}</div>
      <div class="hero-bar"><i style="width:${ys.income > 0 ? Math.min(100, pct(ys.expense, ys.income)) : 0}%"></i></div>
      <div class="hero-meta"><span>지출 ${ys.income > 0 ? pct(ys.expense, ys.income) : 0}%</span><span>저축률 ${ys.income > 0 ? rate + '%' : '–'}</span></div>
      <div class="hero-split">
        <div><span>수입</span><b>${won(ys.income)}</b></div>
        <div><span>지출</span><b>${won(ys.expense)}</b></div>
        ${ys.saving ? `<div><span>투자</span><b>${won(ys.saving)}</b></div>` : ''}
      </div>
    </section>
    <section class="card">
      <div class="row"><h2>월별</h2><span class="legend"><i class="lg-in"></i>수입 <i class="lg-ex"></i>지출</span></div>
      <div class="ychart">${ys.months.map(m => `
        <button class="ycol ${m.counted ? '' : 'dim'} ${m.m === ym(new Date()) ? 'now' : ''}" data-open-month="${m.m}">
          <span class="ybars">
            <i class="yb-in" style="height:${m.counted ? Math.round(m.income / max * 100) : 0}%"></i>
            <i class="yb-ex" style="height:${m.counted ? Math.round(m.expense / max * 100) : 0}%"></i>
          </span>
          <span class="ylab">${Number(m.m.slice(5))}</span>
        </button>`).join('')}
      </div>
    </section>
    <section class="card grid2 compact">
      <div class="stat"><div class="label">고정지출</div><div class="value">${won(ys.fixedExpense)}</div></div>
      <div class="stat"><div class="label">변동지출</div><div class="value">${won(ys.varExpense)}</div></div>
    </section>
    <section class="card">
      <h2>지출 구성</h2>
      ${cats.length ? `
        <div class="donut-wrap">${donut(cats, ys.varExpense)}<div class="donut-center"><span>변동지출</span><b>${shortWon(ys.varExpense)}원</b></div></div>
        <ul class="list cats">${cats.map(([c, v]) => `
          <li><div class="li-main">${catIcon(c)}<div><div class="title">${esc(c)}</div><div class="sub">${pct(v, ys.varExpense)}%</div></div></div>
          <div class="amount">${won(v)}</div></li>`).join('')}</ul>` : `<div class="empty">기록 없음</div>`}
    </section>`;
}

function renderYearTx() {
  const ys = yearStats(Number(viewMonth.slice(0, 4)));
  const rows = ys.months.filter(m => m.counted || m.txCount).reverse();
  view.innerHTML = `
    <section class="card grid2 compact">
      <div class="stat"><div class="label">${ys.y}년 수입</div><div class="value income">${won(ys.income)}</div></div>
      <div class="stat"><div class="label">${ys.y}년 지출</div><div class="value expense">${won(ys.expense)}</div></div>
    </section>
    <section class="card">
      ${rows.length ? `<ul class="list">${rows.map(m => `
        <li data-open-month="${m.m}">
          <div class="li-main"><span class="cat-ic" style="--c:var(--gold)">${Number(m.m.slice(5))}</span>
            <div><div class="title">${Number(m.m.slice(5))}월</div><div class="sub">${m.txCount}건</div></div></div>
          <div style="text-align:right"><div class="amount ${m.net < 0 ? 'expense' : ''}">${m.net < 0 ? '−' : '+'}${won(Math.abs(m.net))}</div>
            <div class="sub muted">−${shortWon(m.expense)}</div></div>
        </li>`).join('')}</ul>` : `<div class="empty">기록 없음</div>`}
    </section>`;
}

// 상단 "2026년 11월" 눌렀을 때: 월/연 전환 + 달력식 선택
function openPicker() {
  let mode = viewMode, y = Number(viewMonth.slice(0, 4));
  const dataMonths = new Set(state.tx.map(t => t.date.slice(0, 7)));
  const draw = () => {
    const cur = ym(new Date());
    form.innerHTML = `
      <div class="seg" style="margin-bottom:14px">
        <input type="radio" name="pm" id="pmM" ${mode === 'month' ? 'checked' : ''}><label for="pmM" data-pmode="month">월</label>
        <input type="radio" name="pm" id="pmY" ${mode === 'year' ? 'checked' : ''}><label for="pmY" data-pmode="year">연</label>
      </div>
      ${mode === 'month' ? `
        <div class="row pk-year"><button type="button" class="icon-btn" data-py="-1">‹</button><b>${y}년</b><button type="button" class="icon-btn" data-py="1">›</button></div>
        <div class="pk-grid">${Array.from({ length: 12 }, (_, i) => {
          const m = `${y}-${String(i + 1).padStart(2, '0')}`;
          return `<button type="button" class="pk ${m === viewMonth && viewMode === 'month' ? 'sel' : ''} ${m === cur ? 'now' : ''}" data-pick="${m}">${i + 1}월${dataMonths.has(m) ? '<i></i>' : ''}</button>`;
        }).join('')}</div>`
      : `<div class="pk-grid">${Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 4 + i).map(yy =>
          `<button type="button" class="pk ${yy === y && viewMode === 'year' ? 'sel' : ''} ${yy === new Date().getFullYear() ? 'now' : ''}" data-pick-year="${yy}">${yy}</button>`).join('')}</div>`}
      <div class="actions"><button type="button" class="btn ghost" data-pk-today>오늘</button><button type="button" class="btn ghost" data-pk-close>닫기</button></div>`;
  };
  draw();
  form.onsubmit = e => e.preventDefault();
  form.onclick = e => {
    const t = e.target.closest('[data-pmode],[data-py],[data-pick],[data-pick-year],[data-pk-today],[data-pk-close]');
    if (!t) return;
    if (t.dataset.pmode) { mode = t.dataset.pmode; draw(); return; }
    if (t.dataset.py) { y += Number(t.dataset.py); draw(); return; }
    if (t.dataset.pick) { viewMode = 'month'; viewMonth = t.dataset.pick; }
    else if (t.dataset.pickYear) { viewMode = 'year'; viewMonth = `${t.dataset.pickYear}-${viewMonth.slice(5)}`; }
    else if ('pkToday' in t.dataset) { viewMode = 'month'; viewMonth = ym(new Date()); }
    selectedDay = null; form.onclick = null; sheet.close(); render();
  };
  sheet.addEventListener('close', () => { form.onclick = null; }, { once: true });
  sheet.showModal();
}

/* ===================== 이벤트 ===================== */
document.querySelector('.tabbar').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  currentTab = b.dataset.tab;
  render();
  window.scrollTo(0, 0);
});
$('#prevMonth').onclick = () => { selectedDay = null; viewMonth = shiftMonth(viewMonth, viewMode === 'year' ? -12 : -1); render(); };
$('#nextMonth').onclick = () => { selectedDay = null; viewMonth = shiftMonth(viewMonth, viewMode === 'year' ? 12 : 1); render(); };
$('#monthLabel').onclick = () => openPicker();
$('#fab').onclick = () => openTxSheet();

view.addEventListener('click', e => {
  const el = e.target.closest('[data-month-sum],[data-bill-import],[data-bill-paid],[data-bill],[data-add-bill],[data-bill-migrate],[data-open-month],[data-import-fixed],[data-clear-ended],[data-sms],[data-day],[data-clear-day],[data-edit-tx],[data-edit-fixed],[data-add-fixed],[data-edit-goal],[data-add-goal],[data-goto],#exportBtn,#importBtn,#resetBtn,#updateBtn,#loginBtn,#logoutBtn,#syncBtn,#dropBtn,#coachBtn,[data-copy]');
  if (!el) return;
  if ('monthSum' in el.dataset) openMonthSumSheet();
  else if ('billImport' in el.dataset) openBillImportSheet();
  else if (el.dataset.billPaid) { const b = state.bills.find(x => x.id === el.dataset.billPaid), m = ym(new Date()); b.paid = { ...(b.paid || {}), [m]: !b.paid?.[m] }; save(); render(); }
  else if (el.dataset.bill) openBillSheet(state.bills.find(x => x.id === el.dataset.bill));
  else if ('addBill' in el.dataset) openBillSheet();
  else if ('billMigrate' in el.dataset) migrateBills();
  else if (el.dataset.openMonth) { viewMode = 'month'; viewMonth = el.dataset.openMonth; selectedDay = null; render(); window.scrollTo(0, 0); }
  else if ('importFixed' in el.dataset) openFixedImportSheet();
  else if ('clearEnded' in el.dataset) {
    const now = ym(new Date());
    if (confirm('끝난 할부를 목록에서 지울까요? (지난 달 통계에서도 빠집니다)')) { state.fixed = state.fixed.filter(f => !f.until || f.until >= now); save(); render(); }
  }
  else if ('sms' in el.dataset) openSmsSheet();
  else if (el.dataset.day) { selectedDay = selectedDay === el.dataset.day ? null : el.dataset.day; render(); }
  else if ('clearDay' in el.dataset) { selectedDay = null; render(); }
  else if (el.dataset.editTx) openTxSheet(state.tx.find(t => t.id === el.dataset.editTx));
  else if (el.dataset.editFixed) openFixedSheet(state.fixed.find(f => f.id === el.dataset.editFixed));
  else if (el.dataset.addFixed === 'insurance') openFixedSheet(null, 'expense', '보험');
  else if (el.dataset.addFixed) openFixedSheet(null, el.dataset.addFixed);
  else if (el.dataset.editGoal) openGoalSheet(state.goals.find(g => g.id === el.dataset.editGoal));
  else if ('addGoal' in el.dataset) openGoalSheet();
  else if (el.dataset.goto) { currentTab = el.dataset.goto; render(); }
  else if (el.id === 'coachBtn') runCoach();
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
  if (e.target.name === 'fxmode') { fixedMode = e.target.value; render(); return; }
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
function handleSharedText() {
  const q = new URLSearchParams(location.search);
  // 고정 항목 목록 링크 (확인 후 등록). # 뒤에 담으면 서버(GitHub)로 전송되지 않는다.
  const h = new URLSearchParams(location.hash.slice(1));
  const fixedList = (h.get('fixed') || q.get('fixed') || '').trim();
  const billList = (h.get('bills') || '').trim();
  const sumList = (h.get('monthsum') || '').trim();
  if (sumList) { history.replaceState(null, '', location.pathname); currentTab = 'tx'; render(); openMonthSumSheet(sumList); return; }
  if (billList) { history.replaceState(null, '', location.pathname); currentTab = 'fixed'; fixedMode = 'bills'; render(); openBillImportSheet(billList); return; }
  const shared = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join('\n').trim();
  if (!shared && !fixedList) return;
  history.replaceState(null, '', location.pathname); // # 부분까지 지움 // 새로고침 시 중복 입력 방지
  if (fixedList) { currentTab = 'fixed'; render(); openFixedImportSheet(fixedList); return; }
  currentTab = 'tx';
  render();
  openSmsSheet(shared);
}
handleSharedText();
window.addEventListener('hashchange', handleSharedText); // 앱이 열려 있는 상태에서 링크를 열어도 처리
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
