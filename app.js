'use strict';

/* ===================== 데이터 ===================== */
// 버전은 배포(scripts/deploy.sh) 때 version.js에 자동으로 매겨진다 — 손으로 올리지 않음
const APP_VERSION = window.EOK_VERSION?.n ? `v${window.EOK_VERSION.n}` : 'dev';
const STORAGE_KEY = 'moneyplan.v1'; // 앱 이름이 '억'으로 바뀌었지만 기존 데이터 호환을 위해 키 유지
const BASE_EXPENSE = ['식비', '배달', '카페/간식', '술·유흥', '교통', '자동차', '쇼핑', '생활용품', '미용', '주거/관리비', '통신', '구독', '보험', '문화/여가', '여행', '운동', '의료', '교육', '반려동물', '가족·커플', '경조사', '세금·수수료', '대출이자', '사업', '기타']; // 사업: 사업용 지출을 개인 계좌로 낸 것(변동지출 예산에서 제외)
const BASE_INCOME = ['수익', '부수입', '사업', '상여', '이자/배당', '용돈', '기타'];
// 사용자 카테고리(settings.customCats)를 기본 목록 뒤('기타' 앞)에 붙인다. 배열은 그 자리에서 갱신(다른 곳이 같은 배열을 참조)
const EXPENSE_CATS = [...BASE_EXPENSE];
const SAVING_CATS = ['주식·ETF', '적금·청약', '연금', '코인', '기타투자'];
const INCOME_CATS = [...BASE_INCOME];
// 줄이기 쉬운(재량) 지출 카테고리 — 목표 달성 부족분을 여기서 우선 깎는다
const DISCRETIONARY = ['카페/간식', '쇼핑', '문화/여가', '식비', '생활용품', '기타'];

// 카테고리 색: 채도를 낮춘 톤으로 통일 (골드·세이지·슬레이트·모브 계열)
const CAT_COLORS = {
  '식비': '#C8A96A', '카페/간식': '#B88A6A', '교통': '#7F93B5', '쇼핑': '#A88BA8', '생활용품': '#8FB8A0',
  '주거/관리비': '#6F8FA3', '통신': '#9AA6B8', '구독': '#C48E9A', '보험': '#8C9C7A', '문화/여가': '#D1B98A',
  '의료': '#7FA8A4', '교육': '#9C8FC4', '가족·커플': '#C79BA0', '배달': '#D1A06A', '술·유흥': '#B07A8C', '자동차': '#7A8FA6', '미용': '#C9A0B4', '여행': '#6FA3C0', '운동': '#8FB88F', '반려동물': '#B8A07A', '세금·수수료': '#9A9A8A', '주식·ETF': '#8FA8C8', '적금·청약': '#A3C2AE', '연금': '#BFAE8E', '코인': '#C8A96A', '기타투자': '#9AA6B8', '경조사': '#C9876F', '대출이자': '#A0705F', '사업': '#6F8F86', '기타': '#8A8F98',
  '수익': '#8FB8A0', '부수입': '#A3C2AE', '상여': '#C8A96A', '이자/배당': '#7FA8A4', '용돈': '#B5A3C4',
};
const PALETTE = ['#C8A96A', '#8FB8A0', '#7F93B5', '#A88BA8', '#C9876F', '#6FA3A0', '#C48E9A', '#9DA36F', '#B5A3C4', '#BFAE8E'];
const catColor = c => CAT_COLORS[c] || PALETTE[[...String(c)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % PALETTE.length];
function refreshCats() {
  const cc = (typeof state !== 'undefined' && state.settings?.customCats) || {};
  const merge = (base, extra) => [...base.slice(0, -1), ...(extra || []).filter(c => !base.includes(c)), '기타'];
  EXPENSE_CATS.splice(0, EXPENSE_CATS.length, ...merge(BASE_EXPENSE, cc.expense));
  INCOME_CATS.splice(0, INCOME_CATS.length, ...merge(BASE_INCOME, cc.income));
}
// 카테고리 아이콘(이모지). 사용자가 만든 카테고리처럼 목록에 없으면 첫 글자로 대신
const CAT_EMOJI = {
  '식비': '🍚', '배달': '🛵', '카페/간식': '☕', '술·유흥': '🍺', '교통': '🚇', '자동차': '🚗', '쇼핑': '🛍️', '생활용품': '🧴',
  '미용': '💇', '주거/관리비': '🏠', '통신': '📱', '구독': '🔁', '보험': '🛡️', '문화/여가': '🎬', '여행': '✈️', '운동': '🏃',
  '의료': '🏥', '교육': '📚', '반려동물': '🐾', '가족·커플': '💑', '경조사': '💐', '세금·수수료': '🧾', '대출이자': '🏦', '사업': '💼', '기타': '📦',
  '수익': '💵', '부수입': '💰', '상여': '🎁', '이자/배당': '💹', '용돈': '🤲',
  '주식·ETF': '📈', '적금·청약': '🐷', '연금': '🌱', '코인': '🪙', '기타투자': '💎',
};
const catIcon = (c, type) => `<span class="cat-ic" style="--c:${catColor(c)}">${CAT_EMOJI[c] || esc(String(c).charAt(0))}</span>`;
// 화면 밝기(기기별): light 기본 / dark / auto(시스템 따라감)
const getTheme = () => { try { return localStorage.getItem('eok.theme') || 'light'; } catch { return 'light'; } };
function setTheme(t) {
  try { localStorage.setItem('eok.theme', t); } catch {}
  document.documentElement.setAttribute('data-theme', t);
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.getElementById('themeColor')?.setAttribute('content', dark ? '#0C1220' : '#EDF0F4');
}

const defaultState = () => ({
  tx: [],      // {id, type:'income'|'expense', amount, category, memo, date:'YYYY-MM-DD'}
  fixed: [],   // {id, type, name, amount, category, day}
  goals: [],   // {id, name, target, saved, deadline:'YYYY-MM', rate}
  assets: [],  // 자산 {id, name, kind, balance, monthly, day, match, accruedTo, updated}
  bills: [],   // 공과금 {id, name, cat, day, rec:{'YYYY-MM': 금액}, paid:{'YYYY-MM': true}}
  funds: [],   // 비정기 지출 적립 {id, name, amount(1회), months:[1~12], start:'YYYY-MM', init, match, category}
  pending: [], // 자동 수집 확인 대기 {id, type, amount, category, memo, date, src(알림 원문 앞부분)} → 사용자가 ✓ 하면 tx로
  settings: { emergency: 0, highDebt: false },
  merchantCats: {}, // 가맹점 → 사용자가 고른 카테고리 (문자 입력 시 학습)
});

let state = load();
refreshCats();
let snap = SyncCore.snapshot(state); // 마지막 저장 시점 스냅샷 — 저장할 때 바뀐 레코드에 수정 시각(u)을 찍는 데 사용
let currentTab = 'home';
let viewMonth = ym(new Date());
let viewMode = 'month'; // 'month' | 'year'
let txMode = 'list';      // 'list' | 'cal'
let selectedDay = null;   // 달력에서 선택한 날짜
let txSrc = '';           // 내역 탭 출처 필터 ('' 전체, '-' 출처 없음, 계좌 id)

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
  refreshCats();
  persist();
  if (!sheet.open) render();
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ===================== 출처(계좌·카드) ===================== */
// settings.accounts = [{id, name, kind:'은행'|'카드'|'페이', biz, match}]
// biz(사업용)인 출처의 거래·자산은 기록은 하되 통계·예산·1억 목표에서 뺀다.
const SOURCES = [ // 알림 원문에서 출처 자동 인식 (카드를 은행보다 먼저 검사)
  ['신한카드', '카드', /신한카드/], ['삼성카드', '카드', /삼성카드/], ['현대카드', '카드', /현대카드/], ['KB국민카드', '카드', /KB국민카드|국민카드/],
  ['하나카드', '카드', /하나카드/], ['우리카드', '카드', /우리카드/], ['롯데카드', '카드', /롯데카드/], ['BC카드', '카드', /BC카드|비씨카드/], ['NH농협카드', '카드', /NH농협카드|농협카드/],
  ['토스뱅크', '은행', /토스뱅크/], ['카카오뱅크', '은행', /카카오뱅크/], ['케이뱅크', '은행', /케이뱅크/],
  ['신한은행', '은행', /신한/], ['하나은행', '은행', /하나은행|KEB/], ['IBK기업은행', '은행', /IBK|기업은행/], ['KB국민은행', '은행', /국민은행|KB스타|KB국민/],
  ['우리은행', '은행', /우리은행|우리WON/], ['NH농협', '은행', /농협|NH/], ['우체국', '은행', /우체국/], ['새마을금고', '은행', /새마을/],
  ['카카오페이', '페이', /카카오페이/], ['네이버페이', '페이', /네이버페이|N[Pp]ay/], ['토스', '페이', /토스/],
];
const accounts = () => state.settings.accounts || [];
const acctOf = t => t && t.acct ? accounts().find(a => a.id === t.acct) : null;
const isBiz = t => !!acctOf(t)?.biz;
// 원문에서 출처 찾기: 사용자가 정한 키워드(match) 우선, 없으면 표에서 찾아 자동 추가
function detectAcct(raw, create = true) {
  const text = String(raw || '');
  const own = accounts().find(a => String(a.match || '').split(',').map(k => k.trim()).filter(Boolean).some(k => text.includes(k)));
  if (own) return own.id;
  const hit = SOURCES.find(([, , re]) => re.test(text)); if (!hit) return '';
  let a = accounts().find(x => x.name === hit[0]);
  if (!a && create) { a = { id: uid(), name: hit[0], kind: hit[1], biz: false, match: '' }; state.settings.accounts = [...accounts(), a]; }
  return a ? a.id : '';
}

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
  const txs = state.tx.filter(t => t.date.startsWith(m) && !isBiz(t)); // 사업용 출처는 제외
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
  // 비정기 지출 적립: 매달 떼어 두는 돈(reserve)은 남은 돈에서 빼고, 적립금으로 낸 지출(fundSpent)은 이미 떼어 둔 돈이라 다시 빼지 않음
  const reserve = actual ? 0 : fundsReserve(m);
  const fundSpent = actual ? 0 : sum(txs.filter(t => t.type === 'expense' && t.fund));
  return { m, txs, income, expense, varIncome, varExpense, fixedIncome, fixedExpense, saving, bills, actual, byCat, reserve, fundSpent, net: income - expense, left: income - expense - saving - reserve + fundSpent, txCount: txs.length };
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

// 화면 전환 애니메이션: 탭·달을 바꿀 때만(저장할 때마다 다시 그리는 경우엔 움직이지 않음)
const TAB_ORDER = ['home', 'tx', 'fixed', 'goals', 'insights'];
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let lastNav = null;
function navAnim() {
  const key = `${currentTab}|${viewMode}|${viewMonth}`, prev = lastNav;
  lastNav = { key, tab: currentTab, month: viewMonth };
  if (!prev) return 'nav-in';
  if (prev.key === key) return '';
  if (prev.tab !== currentTab) return TAB_ORDER.indexOf(currentTab) > TAB_ORDER.indexOf(prev.tab) ? 'nav-l' : 'nav-r';
  return viewMonth > prev.month ? 'nav-l' : viewMonth < prev.month ? 'nav-r' : 'nav-in';
}
// 맨 위 금액: 0에서 올라가며 세기
function countUp(el) {
  const to = Number(el.dataset.v); if (!isFinite(to) || !to) return;
  el.textContent = won(0); // 최종값이 먼저 보였다가 다시 세지 않게
  const t0 = performance.now(), dur = 700;
  const step = t => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = won(to * e); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
// 스크롤: 화면 아래에 있던 카드는 보일 때 한 번 떠오름
const revealIO = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(x => {
  if (x.isIntersecting) { x.target.classList.add('shown'); revealIO.unobserve(x.target); } }), { rootMargin: '0px 0px -8% 0px' }) : null;
function animateView(cls) {
  if (!cls || reduceMotion()) return;
  view.classList.remove('nav-in', 'nav-l', 'nav-r'); void view.offsetWidth; view.classList.add(cls);
  const amt = view.querySelector('.hero-amount[data-v]'); if (amt) countUp(amt);
  if (revealIO) view.querySelectorAll(':scope > section').forEach(s => {
    if (s.getBoundingClientRect().top > innerHeight) { s.classList.add('reveal'); revealIO.observe(s); } });
}

function render() {
  const anim = navAnim();
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === currentTab));
  $('#monthLabel').textContent = viewMode === 'year' ? `${viewMonth.slice(0, 4)}년` : monthLabel(viewMonth);
  $('#monthPicker').style.visibility = (currentTab === 'home' || currentTab === 'tx') ? 'visible' : 'hidden';
  $('#fab').style.display = (currentTab === 'home' || currentTab === 'tx') ? '' : 'none';
  ({ home: renderHome, tx: renderTx, fixed: renderFixed, goals: renderGoals, insights: renderInsights })[currentTab]();
  view.insertAdjacentHTML('beforeend', `<footer class="credit">억 ${APP_VERSION} · 앱 제작자 KEUN</footer>`);
  animateView(anim);
}

// 맨 위 카드: 수입 하나를 막대 하나로 — 🔁 고정 · 🛒 생활 · 📈 투자(+적립) · 남음. 같은 숫자를 두 번 쓰지 않음
function heroHtml(label, st) {
  const inc = st.income || 0, sav = (st.saving || 0) + (st.reserve || 0);
  const base = Math.max(inc, (st.expense || 0) + sav, 1);
  const w = v => Math.max(0, v / base * 100).toFixed(1);
  const P = v => inc > 0 ? `${Math.round(v / inc * 100)}%` : '';
  const seg = (name, v) => v / base >= 0.2 ? `${name} ${P(v)}` : v / base >= 0.1 ? P(v) : ''; // 칸이 좁으면 이름 생략
  return `<section class="hero">
    <div class="hero-label">${label}</div>
    <div class="hero-amount ${st.left < 0 ? 'neg' : ''}" data-v="${Math.round(st.left)}">${won(st.left)}</div>
    <div class="hero-stack">
      <i class="a-fix" style="width:${w(st.fixedExpense || 0)}%">${seg('고정', st.fixedExpense || 0)}</i><i class="a-liv" style="width:${w(st.varExpense || 0)}%">${seg('생활', st.varExpense || 0)}</i><i class="a-sav" style="width:${w(sav)}%">${seg('저축', sav)}</i>
      ${inc > 0 ? '<b class="half" title="억 원칙 50%"></b>' : ''}
    </div>
    <div class="hero-split">
      <div><span>💵 수입</span><b class="income">+${shortWon(inc)}</b></div>
      <div><span>💸 지출 ${P(st.expense || 0)}</span><b class="expense">−${shortWon(st.expense || 0)}</b><small><i class="dot a-fix"></i>고정 ${shortWon(st.fixedExpense || 0)}</small><small><i class="dot a-liv"></i>생활 ${shortWon(st.varExpense || 0)}</small></div>
      <div><span>📈 저축·투자 ${P(sav)}</span><b>${shortWon(sav)}</b>${st.reserve ? `<small>🫙 적립 ${shortWon(st.reserve)}</small>` : ''}</div>
    </div>
  </section>`;
}

function renderHome() {
  if (viewMode === 'year') return renderYearHome();
  const s = monthStats(viewMonth);
  const rate = s.income > 0 ? Math.round((s.net / s.income) * 100) : 0;
  const cats = Object.entries(s.byCat).sort((a, b) => b[1] - a[1]);
  const recent = [...s.txs].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 5);
  const spentPct = s.income > 0 ? Math.min(100, pct(s.expense, s.income)) : 0;

  view.innerHTML = `
    ${heroHtml('💰 이번 달 남은 돈', s)}
    ${(state.pending || []).length ? `<button class="sms-cta" data-pending><span class="cat-ic" style="--c:var(--gold)">📥</span><span><b>확인 ${state.pending.length}</b></span><span class="chev">›</span></button>` : ''}

    ${guideHtml()}
    ${eokHtml()}
    ${allocHtml()}
    ${reviewHtml()}
    ${budgetHtml()}
    ${uncategorized().length ? `<button class="sms-cta" data-classify><span class="cat-ic" style="--c:var(--gold)">❓</span><span><b>분류 필요 ${uncategorized().length}</b></span><span class="chev">›</span></button>` : ''}


    <section class="card">
      <h2>🛒 생활비 분류</h2>
      ${cats.length ? `
        <div class="donut-wrap">
          ${donut(cats, s.varExpense)}
          <div class="donut-center"><span style="font-size:28px">🛒</span></div>
        </div>
        <ul class="list cats">${cats.map(([c, v]) => `
          <li data-cat-detail="${esc(c)}" data-scope="month"><div class="li-main">${catIcon(c)}<div><div class="title">${esc(c)}</div><div class="sub">${v / s.varExpense < 0.01 ? '1% 미만' : pct(v, s.varExpense) + '%'}</div></div></div>
          <div class="amount">${won(v)}</div></li>`).join('')}</ul>`
        : `<div class="empty">기록 없음</div>`}
    </section>

    <section class="card">
      <div class="row"><h2>🧾 최근 내역</h2>${s.txs.length ? `<button class="link-btn" data-goto="tx">전체 ›</button>` : ''}</div>
      ${recent.length ? `<ul class="list">${recent.map(txItem).join('')}</ul>` : `<div class="empty">기록 없음</div>`}
    </section>
    ${state.goals.some(g => g !== eokInfo().g) ? renderGoalSummary() : ''}
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

/* ===================== 억까지 (홈 카드) ===================== */
// 앱 컨셉: 1억 만들기. 지금 어디쯤인지·이 속도면 언제인지·무엇을 하면 빨라지는지 한 장에 보여 준다.
// 수익률은 0%로 계산(사용자 결정: 주식은 떨어질 수도 있으니 보수적으로).
const bizNet = m => { // 개인 계좌로 오간 사업 돈: '사업' 수입 − '사업' 지출
  const txs = state.tx.filter(t => t.date.startsWith(m) && t.category === '사업' && !isBiz(t));
  return sum(txs.filter(t => t.type === 'income')) - sum(txs.filter(t => t.type === 'expense'));
};
function eokInfo() {
  const g = state.goals.find(x => x.target === 1e8) || state.goals[0];
  const target = g?.target || 1e8;
  const cur = g ? (Number(g.saved) || 0) : ((state.assets || []).length ? assetTotals().fin : 0);
  const now = ym(new Date());
  const pace = sum(activeFixed(now).filter(f => f.type === 'saving')); // 매달 자동으로 모으는 돈
  const biz = bizNet(now);
  const months = pace > 0 ? monthsToReach(target, cur, pace, 0) : Infinity;
  const left = g?.deadline ? Math.max(1, monthDiff(now, g.deadline)) : 0;
  const need = left ? requiredMonthly(target, cur, left, 0) : 0;
  const steps = [0.1, 0.3, 0.5, 0.7, 1].map(r => Math.round(target * r));
  const next = steps.find(v => v > cur) || target;
  const faster = pace > 0 && isFinite(months) ? months - monthsToReach(target, cur, pace + 100000, 0) : 0;
  const bizGoal = Number(state.settings.bizGoal) || 0;
  const monthsBiz = bizGoal > 0 ? monthsToReach(target, cur, pace + bizGoal, 0) : Infinity;
  return { g, target, cur, now, pace, biz, bizGoal, monthsBiz, months, need, steps, next, faster, deadline: g?.deadline || '' };
}
const etaLabel = (now, months) => !isFinite(months) || months > 600 ? '–' : months <= 0 ? '달성 🎉' : shiftMonth(now, months).replace('-', '.');
function eokHtml() {
  if (viewMode !== 'month' || viewMonth !== ym(new Date())) return '';
  const e = eokInfo();
  if (!e.g && !(state.assets || []).length) return '';
  const p = Math.min(100, pct(e.cur, e.target));
  const short = e.need > e.pace ? e.need - e.pace : 0;
  return `<section class="card eok-card" data-goto="goals">
    <div class="row"><h2>🏁 1억까지</h2><span class="muted">${shortWon(e.cur)} / ${shortWon(e.target)}</span></div>
    <div class="row"><span class="big">${p}%</span><span class="muted">${e.cur >= e.target ? '🎉' : `📅 도달 ${etaLabel(e.now, e.months)}`}</span></div>
    <div class="eok-bar"><i style="width:${p}%"></i>${e.steps.slice(0, -1).map(v => `<b class="${e.cur >= v ? 'on' : ''}" style="left:${pct(v, e.target)}%"></b>`).join('')}</div>
    <div class="eok-steps">${e.steps.map(v => `<span class="${e.cur >= v ? 'on' : v === e.next ? 'next' : ''}">${e.cur >= v ? '✓ ' : ''}${shortWon(v)}</span>`).join('')}</div>
    <table class="mini">
      ${(() => { const lk = (state.assets || []).filter(a => !a.biz && a.kind !== '부채' && isPension(a)).reduce((t, a) => t + (a.balance || 0), 0); return lk ? `<tr><td>🔒 연금</td><td class="muted">${shortWon(lk)}</td></tr>` : ''; })()}
      <tr data-biz-goal><td>💼 사업 순수익</td><td><span class="${e.biz < 0 ? 'expense' : e.biz > 0 ? 'income' : ''}">${e.biz > 0 ? '+' : e.biz < 0 ? '−' : ''}${shortWon(Math.abs(e.biz))}</span>${e.bizGoal ? ` / ${shortWon(e.bizGoal)}` : ''} ›</td></tr>
      ${e.bizGoal ? `<tr><td colspan="2"><div class="bar"><i style="width:${Math.min(100, Math.max(0, pct(e.biz, e.bizGoal)))}%"></i></div></td></tr>` : ''}
      ${e.deadline && e.cur < e.target ? `<tr><td>⏰ 기한 ${e.deadline.replace('-', '.')}</td><td>월 ${shortWon(e.need)}${short ? ` <b class="expense">+${shortWon(short)}</b>` : ' ✓'}</td></tr>` : ''}
      ${e.bizGoal && isFinite(e.monthsBiz) && e.cur < e.target ? `<tr><td>🚀 사업 목표 달성 시</td><td class="income">${etaLabel(e.now, e.monthsBiz)}</td></tr>` : ''}
      ${e.faster >= 1 ? `<tr><td>⚡ 월 10만 더 모으면</td><td class="income">${e.faster}개월 빨리</td></tr>` : ''}
    </table>
    ${eokStepLog()}
    ${eokBars()}
    <details class="hint" onclick="event.stopPropagation()"><summary>? 계산 방법</summary>수익률 0%. 매달 = 고정 탭 투자·적금 합계. 사업 = 사업 수입 − 지출.</details>
  </section>`;
}
// 단계 달성 기록: settings.eokSteps = { 금액: 'YYYY-MM-DD' | '' }. 처음 실행 때 이미 넘은 단계는 날짜 없이 기록(축하 없음)
function checkEokSteps() {
  const e = eokInfo(); if (!e.g) return false;
  const first = !state.settings.eokSteps, rec = state.settings.eokSteps || {};
  let changed = first; const hit = [];
  for (const v of e.steps) if (e.cur >= v && !(v in rec)) { rec[v] = first ? '' : todayStr(); changed = true; if (!first) hit.push(v); }
  if (changed) state.settings.eokSteps = rec;
  if (hit.length) setTimeout(() => toast(`🎉 ${shortWon(hit.at(-1))}원 달성!`), 600);
  return changed;
}
function eokStepLog() {
  const rec = Object.entries(state.settings.eokSteps || {}).filter(([, d]) => d).sort((a, b) => b[1].localeCompare(a[1]));
  return rec.length ? `<div class="hint">🏆 ${rec.slice(0, 3).map(([v, d]) => `${shortWon(Number(v))}원 ${d.slice(2).replace(/-/g, '.')}`).join(' · ')}</div>` : '';
}
// 최근 6개월 '모은 돈'(투자·적금) 막대
function eokBars() {
  const now = ym(new Date()), start = startMonth();
  const ms = [5, 4, 3, 2, 1, 0].map(i => { const m = shiftMonth(now, -i); return { m, v: m < start ? 0 : monthStats(m).saving }; }); // 기록 시작 전 달은 0(고정 항목이 가짜로 잡히지 않게)
  const max = Math.max(...ms.map(x => x.v));
  if (!(max > 0)) return '';
  return `<div class="hint" style="margin-top:10px">📈 월별 저축·투자</div><div class="eok-months">${ms.map(x => `<div class="${x.m === now ? 'cur' : ''}"><small>${x.v ? shortWon(x.v) : ''}</small><i style="height:${Math.max(2, Math.round(x.v / max * 100))}%"></i><span>${Number(x.m.slice(5))}월</span></div>`).join('')}</div>`;
}
function openBizGoalSheet() {
  openSheet(`<h2>💼 사업 순수익 목표</h2>
    <label>월 목표</label><input name="bizGoal" data-money inputmode="numeric" value="${moneyVal(state.settings.bizGoal)}" placeholder="0" />
    <div class="hint">순수익 = '사업' 수입 − '사업' 지출. 0이면 목표 없음.</div>`,
    fd => { state.settings.bizGoal = parseAmount(fd.bizGoal); });
}
// 어떤 지출을 매달 줄여 모으면 억이 얼마나 빨라지는지
function eokFasterHint(amount) {
  const e = eokInfo();
  if (!(e.pace > 0) || !isFinite(e.months) || e.cur >= e.target || !(amount > 0)) return '';
  const d = e.months - monthsToReach(e.target, e.cur, e.pace + amount, 0);
  return d >= 1 ? `<div class="hint">🏁 이만큼 매달 모으면 억이 ${d}개월 빨라짐 · 절반만 줄여도 ${Math.max(0, e.months - monthsToReach(e.target, e.cur, e.pace + amount / 2, 0))}개월</div>` : '';
}

// 수익 배분: 수입을 고정비·생활비·저축으로 어떻게 나누고 있는지 + 목표 기한에 맞추려면 어떻게 나눠야 하는지 (수익률 0%)
// 억 원칙(사용자 결정): 저축·투자 ≥ 지출(고정비+생활비) → 수익의 절반 이상 저축. 연금은 바로 못 쓰는 돈이라 소극적으로.
const eokRule = () => (Number(state.settings.profile?.saveRate) || 50) / 100; // 내 상황의 저축 목표(기본 50% = 억 원칙)
const isPension = x => /연금|IRP/i.test(x.name || '') || x.category === '연금';
function allocHtml() {
  if (viewMode !== 'month' || viewMonth !== ym(new Date())) return '';
  const b = budgetInfo(), s = b.s, e = eokInfo();
  const income = s.income; if (!(income > 0)) return '';
  const fixed = s.fixedExpense, sav = s.saving + s.reserve, living = income - fixed - sav;
  const P = v => `${Math.round(v / income * 100)}%`;
  const rSav = Math.max(sav, Math.ceil(income * eokRule() / 10000) * 10000), rLiving = income - fixed - rSav; // 억 원칙
  const pen = sum(activeFixed(ym(new Date())).filter(f => f.type === 'saving' && isPension(f)));
  const ok = sav >= fixed + living;
  // 맨 위 카드에 이미 있는 '지금' 숫자는 다시 쓰지 않고, 바꿔야 할 것만 '지금 → 목표'로
  const lines = [];
  // ⏰ 기한 판정은 🏁 카드에만(두 카드가 다른 기준으로 ✓/부족을 말하지 않게)
  if (pen > sav * 0.2) lines.push(`🔒 연금 월 ${shortWon(pen)}`);
  return `<section class="card">
    <div class="row"><h2>⚖️ 저축 ${Math.round(eokRule() * 100)}% 원칙</h2><span class="${ok ? 'income' : 'expense'}">${ok ? '✓ 지킴' : rLiving < 0 ? '⛔ 고정비 과다' : '⚠ 미달'}</span></div>
    ${ok ? '' : `<div class="alloc-row"><span>🛒 생활비 ≤</span><b class="${rLiving < 0 ? 'expense' : ''}">${rLiving < 0 ? '−' : ''}${shortWon(Math.abs(rLiving))}</b><span>📈 저축 ≥</span><b class="income">${shortWon(rSav)}</b></div>`}
    ${lines.length ? `<div class="hint">${lines.join(' · ')}</div>` : ''}
    <details class="hint"><summary>? 원칙</summary>📈 ≥ 💸 (수익 50%+) · 🛟 → 적금 → 투자 → 🔒 소액 · 수익률 0%</details>
  </section>`;
}

/* ===================== 길잡이 (사용자 상황별 추천) ===================== */
// 규칙 엔진(guide.js)에 넣을 숫자를 모은다. 계획(고정 항목) 기준 + 생활비는 최근 실적 평균.
function guideContext() {
  const now = ym(new Date()), b = budgetInfo(), s = b.s, act = activeFixed(now);
  const byCat = {};
  act.filter(f => f.type === 'expense').forEach(f => { byCat[f.category] = (byCat[f.category] || 0) + f.amount; });
  byCat['주거/관리비'] = (byCat['주거/관리비'] || 0) + billsTotal(now);
  const sav = act.filter(f => f.type === 'saving');
  // 생활비: 최근 3개월. 월 합계로 넣은 달(실제 기록)은 그 달 지출 − 지금 고정비로 추정. 사업·적립금 지출 제외
  const months = [1, 2, 3].map(i => shiftMonth(now, -i)).map(m => {
    const st = monthStats(m), biz = sum(st.txs.filter(t => t.type === 'expense' && (t.category === '사업' || t.fund)));
    const v = st.actual ? st.expense - s.fixedExpense - biz : st.varExpense - biz;
    return { v, byCat: st.byCat, ok: st.txCount > 0 && v > 0 };
  }).filter(x => x.ok);
  const variable = months.length ? months.reduce((a, x) => a + x.v, 0) / months.length : Math.max(b.spent, b.projected || 0);
  const varByCat = {};
  (months.length ? months : [{ byCat: s.byCat }]).forEach(x => Object.entries(x.byCat).forEach(([k, v]) => { varByCat[k] = (varByCat[k] || 0) + v / Math.max(1, months.length); }));
  const assets = (state.assets || []).filter(a => !a.biz);
  const cash = Math.max(Number(state.settings.emergency) || 0, assets.filter(a => a.kind === '현금').reduce((t, a) => t + (a.balance || 0), 0));
  const inst = act.filter(f => f.type === 'expense' && isInst(f));
  const e = eokInfo();
  return {
    income: s.income, fixed: { total: s.fixedExpense, byCat },
    saving: sum(sav) + s.reserve, pension: sum(sav.filter(isPension)), etfItems: sav.filter(f => f.category === '주식·ETF').length, coinSaving: sum(sav.filter(f => f.category === '코인')),
    variable: Math.round(variable), varByCat, cash, debtHigh: !!state.settings.highDebt || assets.some(a => a.kind === '부채' && /카드론|현금서비스|리볼빙/.test(a.name)),
    installments: { sum: sum(inst), endSoon: sum(inst.filter(f => f.until <= shiftMonth(now, 1))) },
    goal: e.g ? { target: e.target, cur: e.cur, need: e.need, pace: e.pace, deadline: e.deadline } : null,
    biz: { net: bizNet(now), goal: Number(state.settings.bizGoal) || 0 },
    recurring: recurringCandidates().length, uncategorized: uncategorized().length, hasAssets: assets.length > 0,
  };
}
// '했어요'로 넘긴 항목은 30일 동안 숨김(그 뒤에도 조건이 그대로면 다시 나옴)
function guideItems() {
  const done = state.settings.guideDone || {}, today = todayStr();
  const d30 = d => { const x = new Date(d); x.setDate(x.getDate() + 30); return `${ym(x)}-${String(x.getDate()).padStart(2, '0')}`; };
  return Guide.build(guideContext(), state.settings.profile).filter(it => !done[it.id] || d30(done[it.id]) < today);
}
function eokGain(amount) { // 매달 amount를 더 모으면 억이 몇 개월 빨라지나(수익률 0%)
  const e = eokInfo();
  if (!(amount > 0) || !(e.pace > 0) || !isFinite(e.months) || e.cur >= e.target) return 0;
  return e.months - monthsToReach(e.target, e.cur, e.pace + amount, 0);
}
function guideRow(it) {
  const g = it.boost ? eokGain(it.impact) : 0;
  // 접힌 상태는 한 줄(아이콘·제목·금액). 눌러야 숫자·할 일·근거가 보임
  const amt = it.impact ? (it.id === 'deficit' ? `월 −${shortWon(it.impact)}` : `월 ${it.boost ? '+' : ''}${shortWon(it.impact)}`) : '';
  return `<details class="guide-item p${Math.min(it.pri, 4)}">
    <summary><b>${it.icon} ${esc(it.title)}</b><span class="gi-r">${g >= 1 ? `<span class="pill ok">🏁 ${g}개월 빨리</span>` : ''}${amt ? `<span class="${it.id === 'deficit' ? 'expense' : it.boost ? 'income' : 'muted'}">${amt}</span>` : ''}</span></summary>
    <div class="sub">${esc(it.why)} <span class="basis ${it.basis}">${Guide.BASIS[it.basis] || ''}${it.src ? ' ' + it.src : ''}</span></div>
    <div class="how">→ ${esc(it.how)}</div>
    <div class="row guide-btns"><span></span><span>${it.action ? `<button type="button" class="link-btn" data-guide-act="${it.action}">바로가기 ›</button>` : ''}<button type="button" class="link-btn" data-guide-done="${it.id}">✓ 했어요</button></span></div>
  </details>`;
}
function guideHtml(all = false) {
  if (!all && (viewMode !== 'month' || viewMonth !== ym(new Date()))) return '';
  const items = guideItems().filter(it => all ? it.id !== 'profile' : !['saverate', 'deadline'].includes(it.id)); // 홈: ⚖️·🏁 카드와 겹침, 조언: 👤 카드와 겹침
  if (!items.length) return all ? `<section class="card"><h2>🧭 길잡이</h2><div class="empty">✓ 지금 할 일 없음</div></section>` : '';
  const show = all ? items : items.slice(0, 3);
  return `<section class="card guide-card">
    <div class="row"><h2>🧭 길잡이</h2>${!all && items.length > 3 ? `<button class="link-btn" data-goto="insights">전체 ${items.length} ›</button>` : ''}</div>
    ${show.map(guideRow).join('')}
    ${all ? `<details class="hint"><summary>근거</summary>
      <span class="basis stat">통계</span>공식 원문 · <span class="basis">일반 기준</span>점검 신호(정답 ✕) · <span class="basis">내 기록</span> · <span class="basis">내 설정</span>
      <ol class="src-list">${Object.entries(Guide.SOURCES).map(([k, s]) => `<li><b>${k}</b> ${esc(s.label)} ${esc(s.show)} · <a href="${s.url}" target="_blank" rel="noopener">${esc(s.org)}</a> (${s.date}) · ${esc(s.note)}</li>`).join('')}</ol>
    </details>` : ''}
  </section>`;
}
const PROFILE_OPTS = {
  job: [['salary', '💼 월급'], ['free', '🧑‍💻 프리랜서'], ['biz', '🏪 사업']],
  home: [['parents', '🏡 부모님'], ['monthly', '🔑 월세'], ['jeonse', '🏠 전세'], ['own', '🏘️ 자가']],
  dependents: [['0', '없음'], ['1', '있음']],
  risk: [['safe', '🛡️ 안정'], ['mid', '⚖️ 중립'], ['bold', '🚀 적극']],
  pension: [['low', '🔒 소극'], ['normal', '🌱 보통']],
  saveRate: [['30', '30%'], ['40', '40%'], ['50', '50%']],
};
const PROFILE_LABEL = { job: '수입', home: '주거', dependents: '부양가족', risk: '투자 성향', pension: '연금', saveRate: '저축 목표' };
function profileHtml() {
  const p = state.settings.profile;
  const v = (k, val) => (PROFILE_OPTS[k].find(o => o[0] === String(val)) || [])[1] || '–';
  return `<section class="card" data-profile>
    <div class="row"><h2>👤 내 상황</h2><span class="chev">›</span></div>
    ${p ? `<div class="chips">${Object.keys(PROFILE_LABEL).map(k => `<span class="chip" style="--c:var(--gold)">${v(k, k === 'dependents' ? (p[k] ? '1' : '0') : p[k])}</span>`).join('')}</div>
      <div class="hint">🛟 ${Guide.emergencyMonths(p)}개월</div>` : '<div class="empty">미설정</div>'}
  </section>`;
}
function openProfileSheet() {
  const p = Object.assign({}, Guide.DEFAULT_PROFILE, state.settings.profile || {});
  const seg = (k) => `<label>${PROFILE_LABEL[k]}</label><div class="seg seg${PROFILE_OPTS[k].length}">${PROFILE_OPTS[k].map(([val, l]) => {
    const cur = k === 'dependents' ? (p[k] ? '1' : '0') : String(p[k]);
    return `<input type="radio" name="${k}" id="pf-${k}-${val}" value="${val}" ${cur === val ? 'checked' : ''}><label for="pf-${k}-${val}">${l}</label>`; }).join('')}</div>`;
  openSheet(`<h2>👤 내 상황</h2>${Object.keys(PROFILE_OPTS).map(seg).join('')}
    `,
    fd => { state.settings.profile = { job: fd.job, home: fd.home, dependents: fd.dependents === '1', risk: fd.risk, pension: fd.pension, saveRate: Number(fd.saveRate) || 50 }; });
}

function renderGoalSummary() {
  const avg = avgStats();
  return `<section class="card"><div class="row"><h2>🎯 목표</h2><button class="link-btn" data-goto="goals">전체 ›</button></div>
    ${state.goals.filter(g => g !== eokInfo().g).map(g => { const p = goalPlan(g, avg); return `
      <div class="cat-row">
        <div class="row"><span class="title">${esc(g.name)}</span><span class="muted">${p.progress}% · 월 ${shortWon(p.need)}</span></div>
        <div class="bar ${p.shortfall > 0 ? 'over' : ''}"><i style="width:${Math.min(100, p.progress)}%"></i></div>
      </div>`; }).join('')}
  </section>`;
}

function txItem(t) {
  return `<li data-edit-tx="${t.id}">
    <div class="li-main">${catIcon(t.category, t.type)}<div><div class="title">${esc(t.memo || t.category)}</div><div class="sub">${esc(t.category)} · ${Number(t.date.slice(8))}일${acctOf(t) ? ` · ${esc(acctOf(t).name)}` : ''}${isBiz(t) ? ' <span class="pill">사업</span>' : ''}${t.auto ? ' <span class="pill">자동</span>' : ''}</div></div></div>
    <div class="amount ${t.type === 'saving' ? 'income' : t.type}">${t.type === 'income' ? '+' : t.type === 'saving' ? '↗' : '−'}${won(t.amount)}</div>
  </li>`;
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
function renderTx() {
  if (viewMode === 'year') return renderYearTx();
  const s = monthStats(viewMonth);
  const monthAll = state.tx.filter(t => t.date.startsWith(viewMonth)); // 사업용 포함(표시용)
  const bySrc = {};
  monthAll.forEach(t => { const k = t.acct && acctOf(t) ? t.acct : '-'; const b = (bySrc[k] = bySrc[k] || { i: 0, e: 0, n: 0 }); b.n++; if (t.type === 'income') b.i += t.amount; else if (t.type === 'expense') b.e += t.amount; });
  if (txSrc && !bySrc[txSrc]) txSrc = '';
  const list = monthAll
    .filter(t => !selectedDay || t.date === selectedDay)
    .filter(t => !txSrc || (txSrc === '-' ? !acctOf(t) : t.acct === txSrc))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const groups = {};
  list.forEach(t => (groups[t.date] = groups[t.date] || []).push(t));
  const dayLabel = d => { const dt = new Date(d + 'T00:00'); return `${dt.getMonth() + 1}월 ${dt.getDate()}일 ${WEEK[dt.getDay()]}요일`; };
  const dayTotal = ts => { ts = ts.filter(t => !isBiz(t)); const e = sum(ts.filter(t => t.type === 'expense')), i = sum(ts.filter(t => t.type === 'income'));
    return `${i ? `<span class="income">+${won(i)}</span> ` : ''}${e ? `<span>−${won(e)}</span>` : ''}`; };

  view.innerHTML = `
    <div class="seg view-seg">
      <input type="radio" name="txmode" id="mList" value="list" ${txMode === 'list' ? 'checked' : ''}><label for="mList">목록</label>
      <input type="radio" name="txmode" id="mCal" value="cal" ${txMode === 'cal' ? 'checked' : ''}><label for="mCal">달력</label>
    </div>
    <div class="row" style="justify-content:flex-end;margin:-4px 0 6px"><button class="link-btn" data-month-sum>✎ 월 합계 입력</button></div>
    <button class="sms-cta" data-sms>
      <span class="cat-ic" style="--c:var(--gold)">✉</span>
      <span><b>문자·카톡 입력</b></span><span class="chev">›</span>
    </button>
    <section class="card grid2 compact">
      <div class="stat"><div class="label">💵 수입 (기록)</div><div class="value income">+${shortWon(s.varIncome)}</div></div>
      <div class="stat"><div class="label">🛒 생활비 (기록)</div><div class="value expense">−${shortWon(s.varExpense)}</div></div>
    </section>
    ${Object.keys(bySrc).length > 1 || accounts().length ? `<div class="chips src-chips">${Object.entries(bySrc).sort((a, b) => (b[1].e + b[1].i) - (a[1].e + a[1].i)).map(([k, v]) => {
      const a = k === '-' ? null : acctOf({ acct: k });
      return `<button class="chip ${txSrc === k ? 'on' : ''}" data-src="${k}" style="--c:${a?.biz ? 'var(--muted)' : 'var(--gold)'}">${a ? esc(a.name) : '출처 없음'}${a?.biz ? ' 💼' : ''} <small>${v.e ? '−' + shortWon(v.e) : ''}${v.i ? ' +' + shortWon(v.i) : ''}</small></button>`; }).join('')}</div>` : ''}
    ${txMode === 'cal' ? calendar(s) : ''}
    ${selectedDay ? `<div class="row filter-chip"><span>📅 선택한 날</span><button class="link-btn" data-clear-day>✕</button></div>` : ''}
    ${list.length ? Object.entries(groups).map(([d, ts]) => `
      <section class="card">
        <div class="row day-head"><span>${dayLabel(d)}</span><span class="amount">${ts.length > 1 ? dayTotal(ts) : ''}</span></div>
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
  const exp = active.filter(f => f.type === 'expense' && !isInst(f) && f.category !== '보험').sort((a, b) => b.amount - a.amount);
  const ins = active.filter(f => f.type === 'expense' && !isInst(f) && f.category === '보험').sort((a, b) => b.amount - a.amount);
  const inst = active.filter(f => f.type === 'expense' && isInst(f)).sort((a, b) => a.until.localeCompare(b.until));
  const ended = state.fixed.filter(f => isInst(f) && f.until < now);
  const sav = active.filter(f => f.type === 'saving').sort((a, b) => b.amount - a.amount);
  const billNow = billsTotal(now);
  const expTotal = sum(exp) + sum(ins) + sum(inst) + billNow, incTotal = sum(inc);
  const endingSoon = sum(inst.filter(f => f.until === now));
  const reserve = fundsReserve(now), recur = recurringCandidates();
  const item = f => `<li data-edit-fixed="${f.id}">
      <div class="li-main">${catIcon(f.category)}<div><div class="title">${esc(f.name)}</div><div class="sub">${esc(f.category)}${f.day ? ` · 매월 ${f.day}일` : ''}${f.until ? ` · ${isInst(f) ? untilLabel(f.until, now) : (f.until < now ? '종료' : '~' + f.until.slice(2).replace('-', '.'))}` : ''}</div></div></div>
      <div class="amount ${f.type}">${won(f.amount)}</div></li>`;
  view.innerHTML = `
    ${fixedSeg()}
    <section class="card">
      <div class="muted">🔁 이번 달 고정지출</div>
      <div class="big expense">${won(expTotal)}</div>
      <div class="muted">${incTotal ? `💵 수입의 ${pct(expTotal, incTotal)}%` : '⚠ 고정 수입 없음'}</div>
      ${inst.length || billNow ? `<div class="muted">${[inst.length ? `🧾 할부 ${shortWon(sum(inst))}` : '', billNow ? `⚡ 공과금 ${shortWon(billNow)}` : ''].filter(Boolean).join(' · ')}</div>` : ''}
      ${sav.length || reserve ? `<div class="muted">${[sav.length ? `📈 투자 ${shortWon(sum(sav))}` : '', reserve ? `🫙 적립 ${shortWon(reserve)}` : '', incTotal ? `💰 남는 돈 ${shortWon(incTotal - expTotal - sum(sav) - reserve)}` : ''].filter(Boolean).join(' · ')}</div>` : ''}
      ${endingSoon ? `<div class="muted">다음 달 −${won(endingSoon)} (할부 끝)</div>` : ''}
    </section>
    <button class="sms-cta" data-import-fixed>
      <span class="cat-ic" style="--c:var(--gold)">📋</span>
      <span><b>목록 붙여넣기</b></span><span class="chev">›</span>
    </button>
    ${recur.length ? `<button class="sms-cta" data-recur><span class="cat-ic" style="--c:var(--gold)">🔁</span><span><b>반복 결제 ${recur.length}건</b><small>고정에 추가</small></span><span class="chev">›</span></button>` : ''}
    <section class="card">
      <div class="row"><h2>💵 수입 <span class="h-sum income">${shortWon(incTotal)}</span></h2><button class="btn sm ghost" data-add-fixed="income">＋ 추가</button></div>
      ${inc.length ? `<ul class="list">${inc.map(item).join('')}</ul>` : `<div class="empty">없음</div>`}
    </section>
    <section class="card">
      <div class="row"><h2>💸 지출 <span class="h-sum expense">${shortWon(sum(exp))}</span></h2><button class="btn sm ghost" data-add-fixed="expense">＋ 추가</button></div>
      ${exp.length ? `<ul class="list">${exp.map(item).join('')}</ul>` : `<div class="empty">없음</div>`}
    </section>
    <section class="card">
      <div class="row"><h2>🛡️ 보험 <span class="h-sum expense">${shortWon(sum(ins))}</span></h2><button class="btn sm ghost" data-add-fixed="insurance">＋ 추가</button></div>
      ${ins.length ? `<ul class="list">${ins.map(item).join('')}</ul>` : `<div class="empty">없음</div>`}
    </section>
    <section class="card">
      <div class="row"><h2>📈 투자 <span class="h-sum income">${shortWon(sum(sav))}</span></h2><button class="btn sm ghost" data-add-fixed="saving">＋ 추가</button></div>
      ${sav.length ? `<ul class="list">${sav.map(item).join('')}</ul>` : `<div class="empty">없음</div>`}
    </section>
    ${fundsHtml(now)}
    ${inst.length ? `<section class="card"><div class="row"><h2>🧾 할부 <span class="h-sum expense">${shortWon(sum(inst))}</span></h2><button class="link-btn" data-inst-end>모두 빼기</button></div><ul class="list">${inst.map(item).join('')}</ul></section>` : ''}
    ${ended.length ? `<section class="card"><div class="row"><h2 class="muted">끝난 할부 ${ended.length}건</h2><button class="link-btn" data-clear-ended>정리</button></div></section>` : ''}
  `;
}
const activeFixed = m => state.fixed.filter(f => !f.until || m <= f.until);
// 할부: 종료 월이 있는 고정 항목 중 할부로 등록한 것(이름에 '할부' 또는 inst 표시). 넷플릭스처럼 끝나는 날만 정한 구독은 할부가 아님
const isInst = f => !!f.until && (!!f.inst || /할부/.test(f.name || ''));
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
    state.fixed.push({ id: uid(), type: it.type, name: it.name.trim(), amount: it.amount, category: it.category, day: it.day || '', ...(it.until ? { until: it.until } : {}), ...(it.kind === 'installment' ? { inst: true } : {}) });
  }
  setTimeout(() => toast(`고정 항목 ${picked.length}건 등록`), 100);
}

function renderGoals() {
  const avg = avgStats();
  view.innerHTML = `
    ${assetsHtml()}
    <section class="card">
      <div class="row"><h2>🎯 목표</h2><button class="btn sm" data-add-goal>＋ 추가</button></div>
      <div class="row"><span class="muted">💰 월 평균 남는 돈</span><b>${shortWon(avg.net)}</b></div>
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
    advice = `<div class="tip warn"><b>월 ${shortWon(p.shortfall)} 부족</b></div>`;
    if (p.cuts.length) {
      advice += `<h3>줄일 곳</h3>
        <table class="mini">${p.cuts.map(c => `<tr><td>${esc(c.category)}</td><td>−${shortWon(c.cut)}</td></tr>`).join('')}</table>`;
    }
    if (!p.cutsCover) {
      advice += `<div class="hint">그래도 월 ${shortWon(p.remainingAfterCuts)} 부족 → 기한·금액 조정</div>`;
    }
  }
  const horizon = p.months <= 12 ? '1년 안 → 예·적금'
    : p.months <= 36 ? '3년 안 → 예금·채권 위주'
    : '3년+ → 분산 ETF 일부';
  return `<section class="card">
    <div class="row"><h2>${esc(g.name)}</h2><button class="link-btn" data-edit-goal="${g.id}">수정</button></div>
    <div class="row"><span class="big">${shortWon(g.saved)}</span><span class="muted">/ ${shortWon(g.target)}</span></div>
    <div class="bar ${ok ? '' : 'over'}"><i style="width:${Math.min(100, p.progress)}%"></i></div>
    <table class="mini" style="margin-top:10px">
      <tr><td>⏰ 기한</td><td>${g.deadline.replace('-', '.')} · ${p.months}개월</td></tr>
      <tr><td>수익률</td><td>${g.rate}%</td></tr>
      <tr><td>월 필요</td><td><b>${shortWon(p.need)}</b></td></tr>
      <tr><td>📅 도달 (남는 돈 전부)</td><td>${eta}</td></tr>
    </table>
    ${advice}
    <div class="muted" style="margin-top:8px">💡 담을 곳: ${horizon}</div>
  </section>`;
}

function renderInsights() {
  const avg = avgStats();
  const tips = buildTips(avg);
  const st = state.settings;
  const monthlyExp = avg.expense;
  const gc = guideContext(), efTarget = Math.round((gc.fixed.total + gc.variable) * Guide.emergencyMonths(Object.assign({}, Guide.DEFAULT_PROFILE, st.profile || {})) / 10000) * 10000; // 길잡이와 같은 기준
  const efCash = Math.max(Number(st.emergency) || 0, (state.assets || []).filter(a => !a.biz && a.kind === '현금').reduce((t, a) => t + (a.balance || 0), 0));
  const efOk = efTarget > 0 && efCash >= efTarget;
  view.innerHTML = `
    ${profileHtml()}
    ${guideHtml(true)}
    ${coachHtml()}
    ${accountCardHtml()}
    <section class="card">
      <h2>📚 참고</h2>
      ${tips.length ? tips.map(t => `<details class="tip ${t.level || ''}"><summary>${esc(t.title)}</summary><div>${t.body}</div></details>`).join('') : `<div class="empty">기록 쌓이는 중</div>`}
    </section>

    <section class="card">
      <h2>🪜 돈 모으는 순서</h2>
      <ol class="ladder">
        <li class="${st.highDebt ? '' : 'done'}">고금리 빚 상환 ${st.highDebt ? '<span class="pill bad">해당</span>' : '<span class="pill ok">없음</span>'}</li>
        <li class="${efOk ? 'done' : ''}">🛟 비상금 ${shortWon(efCash)} / ${shortWon(efTarget)} ${efOk ? '<span class="pill ok">충족</span>' : '<span class="pill bad">부족</span>'}</li>
        <li>적금·청약 (바로 쓸 수 있는 돈)</li>
        <li>분산 ETF 적립 · ISA</li>
        <li>연금저축·IRP는 세액공제용 소액만 🔒</li>
        <li>개별주·코인은 소액만</li>
      </ol>
    </section>

    <section class="card">
      <h2>🛟 내 상태</h2>
      <label>비상금 (현금)</label>
      <input id="setEmergency" inputmode="numeric" value="${st.emergency ? st.emergency.toLocaleString('ko-KR') : ''}" placeholder="0" />
      <label style="display:flex;align-items:center;gap:8px;color:var(--text)"><input type="checkbox" id="setDebt" style="width:auto" ${st.highDebt ? 'checked' : ''}/> 고금리 빚 있음</label>
    </section>

    <section class="card"><div class="row"><h2>🎨 화면</h2>
      <div class="seg seg3 theme-seg">${[['light', '☀️ 밝게'], ['dark', '🌙 어둡게'], ['auto', '⚙ 자동']].map(([v, l]) => `<button type="button" class="${getTheme() === v ? 'on' : ''}" data-theme-set="${v}">${l}</button>`).join('')}</div></div></section>
    ${acctsHtml()}
    ${catsHtml()}
    <section class="card">
      <h2>💾 데이터</h2>
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
    fixedExpenses: act.filter(f => f.type === 'expense' && !isInst(f) && f.category !== '보험').map(pick),
    insurance: act.filter(f => f.type === 'expense' && f.category === '보험').map(pick),
    installments: act.filter(f => f.type === 'expense' && isInst(f)).map(pick),
    utilities: (state.bills || []).map(b => ({ name: b.name, type: b.cat, recentAvg: billAvg(b), thisMonth: billAmount(b, now).v })),
    investmentsMonthly: act.filter(f => f.type === 'saving').map(pick),
    sinkingFunds: (state.funds || []).map(f => { const x = fundInfo(f, now); return { name: f.name, perTime: f.amount, months: f.months, monthlyReserve: x.monthly, balance: x.balance, nextDue: x.due, shortAtDue: x.short }; }),
    goals: state.goals.map(g => ({ name: g.name, target: g.target, saved: g.saved, deadline: g.deadline, assumedReturnPct: g.rate })),
    emergencyFundCash: state.settings.emergency || (state.assets || []).filter(a => a.kind === '현금').reduce((t, a) => t + (a.balance || 0), 0), // 직접 입력 없으면 현금 자산 합
    thisMonth: (() => { const b = budgetInfo(); return { roomForVariableSpending: b.room, variableBudget: b.budget || null, variableSpentSoFar: b.spent, dayOfMonth: b.day }; })(),
    financialAssets: assetTotals().fin,
    previousAdvice: state.settings.aiAdvice ? { date: new Date(state.settings.aiAdvice.at).toISOString().slice(0, 10), score: state.settings.aiAdvice.data.score, actions: (state.settings.aiAdvice.data.actions || []).map(a => a.title) } : null,
    highInterestDebt: !!state.settings.highDebt,
    profile: state.settings.profile || '미설정',
    appGuide: (() => { try { return Guide.build(guideContext(), state.settings.profile).map(i => ({ pri: i.pri, title: i.title, why: i.why, how: i.how, monthly: i.impact || null, basis: Guide.BASIS[i.basis] || null })); } catch { return []; } })(),
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
        <div><b>왜</b> ${esc(x.why)}</div><div><b>어떻게</b> ${esc(x.how)}</div>${x.rule ? `<div><b>원칙</b> ${esc(x.rule)}</div>` : ''}</details>`).join('')}
    ${d.progress ? `<div class="tip"><b>지난 진단 이후</b>${esc(d.progress)}</div>` : ''}
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
      <div id="dropBox">${dropHtml()}</div>
      ${ingestLogHtml()}`;
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
// 자동 수집은 '모든 앱'에서 올 수 있어, 금융기관 표시가 있는 알림만 받는다(친구 카톡 "3만원 입금했어" 같은 것 제외)
const FIN_MARK = /카드|은행|뱅크|BANK|페이|Pay|증권|Web발신|잔액|누적|일시불|할부|체크|\b(KB|NH|IBK|SC|BC|KEB|SH)\b|토스|카카오뱅크|케이뱅크|우체국|새마을|신협|농협|수협/i;
const TX_MARK = /승인|결제|사용|입금|출금|이체|취소|일시불|할부|잔액|누적|지급|환불|충전|송금|출금|인출/;
const looksLikeSentence = memo => { const m = String(memo || '').trim(); return /^\d+\s*[.)]\s/.test(m) || m.length > 22 || /[(（]\s*$/.test(m); };
function ingest(texts) {
  // 알림 1건씩 해석해 결과를 '수집 기록'에 남긴다(안 들어온 이유를 폰에서 바로 확인하기 위해)
  let added = 0, removed = 0, balUp = 0, ignored = 0, waiting = 0;
  const log = [];
  state.pending = state.pending || [];
  for (const raw of texts) {
    const text = String(raw || '').trim();
    if (!FIN_MARK.test(text)) { ignored++; log.push({ at: Date.now(), r: '무시', text: text.slice(0, 40) }); continue; } // 금융 알림 아님: 앞부분만
    // 금융 단어가 있어도 거래 동작(승인·입금 등)이 없으면 안내·광고·메모 알림 → 자동 등록 안 함
    if (!TX_MARK.test(text)) { log.push({ at: Date.now(), r: '해석 실패', text: text.slice(0, 300) }); continue; }
    const items = buildSmsItems(text);
    const res = [];
    for (const it of items) {
      if (applyBalance(it)) { balUp++; res.push('잔액'); }
      // 승인취소: 저장된 원 거래는 삭제, 아직 확인 대기 중인 원 거래면 대기 목록에서 뺀다
      if (it.type === 'cancel') {
        if (it.cancelTarget) { state.tx = state.tx.filter(t => t.id !== it.cancelTarget); removed++; res.push('취소'); continue; }
        const p = state.pending.find(x => x.type === 'expense' && x.amount === it.amount);
        if (p) { state.pending = state.pending.filter(x => x !== p); removed++; res.push('취소'); } else res.push('취소 대상 없음');
        continue;
      }
      if (!it.on) { res.push(it.dup ? '중복' : it.fixedHit ? '고정' : '제외'); continue; }
      if (it.billId && recordBill(it)) { added++; res.push('공과금'); continue; }
      const memo = it.memo.trim();
      if (state.pending.some(x => x.date === it.date && x.amount === it.amount && x.memo === memo)) { res.push('중복'); continue; }
      if ((state.settings.pendNo || []).includes(pendKey({ date: it.date, amount: it.amount, memo }))) { res.push('버린 내역'); continue; }
      // 바로 저장하지 않고 '📥 확인' 목록으로 — 결제 알림처럼 보이는 다른 알림(텔레그램 등)이 지출로 들어가는 것 방지
      const acct = detectAcct(it.raw || text);
      state.pending.push({ id: uid(), type: it.type, amount: it.amount, category: it.category, memo, date: it.date, auto: true, src: text.slice(0, 200),
        ...(looksLikeSentence(memo) ? { odd: true } : {}), ...(it.fundId ? { fund: it.fundId } : {}), ...(acct ? { acct } : {}) });
      waiting++; res.push('확인 대기');
    }
    log.push({ at: Date.now(), r: res.length ? [...new Set(res)].join('·') : '해석 실패', text: text.slice(0, 300) });
  }
  if (balUp) syncLinkedGoals();
  state.settings.ingestLog = [...log.reverse(), ...(state.settings.ingestLog || [])].slice(0, 40);
  save(); if (!sheet.open) render();
  toast([waiting && `📥 확인 ${waiting}`, added && `공과금 ${added}`, removed && `취소 ${removed}`, ignored && `무시 ${ignored}`].filter(Boolean).join(' · ') || '📥 새 내역 없음');
}
// 📥 확인 대기: 자동 수집된 알림을 한 건씩 ✓ 저장 / ✕ 버리기. 카테고리는 저장 전에 고를 수 있다.
const pendKey = p => `${p.date}|${p.amount}|${p.memo}`;
function openPendingSheet() {
  const draw = () => {
    const list = [...(state.pending || [])].sort((a, b) => b.date.localeCompare(a.date));
    if (!list.length) { sheet.close(); render(); return; }
    form.innerHTML = `<div class="row"><h2>📥 확인 ${list.length}</h2>${list.length > 1 ? '<button type="button" class="link-btn" data-pend-all>✓ 모두 저장</button>' : ''}</div>
      ${list.map(p => { const cats = p.type === 'income' ? INCOME_CATS : EXPENSE_CATS; return `
        <div class="sms-item" data-pend="${p.id}">
          <div class="row"><div><div class="title">${esc(p.memo || '–')}${p.odd ? ' <span class="pill bad">⚠ 확인</span>' : ''}</div>
            <div class="sub">${Number(p.date.slice(5, 7))}/${Number(p.date.slice(8))} · ${p.type === 'income' ? '💵 수입' : '💸 지출'}</div></div>
            <b class="${p.type === 'income' ? 'income' : 'expense'}">${p.type === 'income' ? '+' : '−'}${won(p.amount)}</b></div>
          ${p.src ? `<div class="ilog-text">${esc(p.src)}</div>` : ''}
          <div class="row" style="gap:8px;margin-top:8px">
            <select data-pend-cat>${cats.map(c => `<option${c === p.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
            <button type="button" class="btn sm ghost" data-pend-no>✕ 버리기</button>
            <button type="button" class="btn sm" data-pend-ok>✓ 저장</button>
          </div>
        </div>`; }).join('')}
      <div class="actions"><button type="button" class="btn ghost" data-act="close">닫기</button></div>`;
  };
  const accept = p => {
    const { src, odd, ...t } = p;
    state.tx.push(t);
    if (t.memo && t.category !== '기타') { state.merchantCats = state.merchantCats || {}; state.merchantCats[t.memo] = t.category; }
  };
  form.onsubmit = e => e.preventDefault();
  form.onchange = e => {
    const s = e.target.closest('[data-pend-cat]'); if (!s) return;
    const p = state.pending.find(x => x.id === s.closest('[data-pend]').dataset.pend); if (p) { p.category = s.value; save(); }
  };
  form.onclick = e => {
    if (e.target.closest('[data-act=close]')) { sheet.close(); return; }
    if (e.target.closest('[data-pend-all]')) {
      const n = state.pending.length; state.pending.forEach(accept); state.pending = [];
      save(); toast(`✓ ${n}건 저장`); sheet.close(); return;
    }
    const ok = e.target.closest('[data-pend-ok]'), no = e.target.closest('[data-pend-no]');
    if (!ok && !no) return;
    const id = (ok || no).closest('[data-pend]').dataset.pend, p = state.pending.find(x => x.id === id); if (!p) return;
    if (ok) accept(p); else state.settings.pendNo = [pendKey(p), ...(state.settings.pendNo || [])].slice(0, 60); // 같은 알림이 다시 와도 안 살아나게
    state.pending = state.pending.filter(x => x.id !== id);
    save(); toast(ok ? '✓ 저장' : '✕ 버림'); draw();
  };
  sheet.addEventListener('close', () => { form.onclick = null; form.onchange = null; render(); }, { once: true });
  draw(); sheet.showModal();
}
function ingestLogHtml() {
  const list = state.settings.ingestLog || [];
  if (!list.length) return '<p class="hint">📥 기록 없음</p>';
  const bad = list.filter(x => /실패|제외|대상 없음|확인 필요/.test(x.r)).length;
  const t = ms => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  return `<details class="ilog"><summary>📥 기록 ${list.length}${bad ? ` · <b class="expense">실패 ${bad}</b>` : ''}</summary>
    <ul class="list">${list.map((x, i) => `<li><div><div class="sub">${t(x.at)} <span class="pill ${x.r.includes('등록') || x.r.includes('확인 대기') || x.r === '공과금' || x.r === '취소' ? 'ok' : /실패|제외|대상 없음|확인 필요/.test(x.r) ? 'bad' : ''}">${esc(x.r)}</span></div>
      <div class="ilog-text">${esc(x.text)}</div></div>${x.r !== '무시' ? `<button class="link-btn" data-ilog="${i}">✉</button>` : ''}</li>`).join('')}</ul>
    <button class="link-btn" data-ilog-clear>지우기</button></details>`;
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
    tips.push({ level: 'warn', title: `💰 남는 비율 ${Math.round(rate * 100)}% — 낮음`, body: '흔히 쓰는 기준은 최소 20%입니다. 월급날 저축액을 먼저 자동이체로 빼고 남은 돈으로 생활하는 "선저축 후지출"로 바꿔보세요.' });
  } else if (rate >= 0.3) {
    tips.push({ level: 'good', title: `💰 남는 비율 ${Math.round(rate * 100)}% — 좋음`, body: '모이는 돈이 그냥 입출금 통장에 머물지 않도록 목표별 계좌로 나눠 두세요.' });
  } else {
    tips.push({ title: `💰 남는 비율 ${Math.round(rate * 100)}%`, body: '나쁘지 않습니다. 20~30% 구간을 유지하면 목표 달성 속도가 안정적이에요.' });
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
    <label>날짜</label><input name="date" type="date" required value="${t.date}" />
    ${accounts().length ? `<label>출처</label><select name="acct"><option value="">–</option>${accounts().map(a => `<option value="${a.id}" ${t.acct === a.id ? 'selected' : ''}>${esc(a.name)}${a.biz ? ' (사업)' : ''}</option>`).join('')}</select>` : ''}
    ${(state.funds || []).length ? `<label>💼 적립금에서</label><select name="fund"><option value="">아니오</option>${state.funds.map(f => `<option value="${f.id}" ${t.fund === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>` : ''}`,
    fd => {
      const amount = parseAmount(fd.amount);
      if (!amount) { alert('금액을 입력하세요'); return false; }
      const rec = { id: t.id || uid(), type: fd.type, amount, category: fd.category, memo: fd.memo.trim(), date: fd.date, ...(t.sum ? { sum: true } : {}), ...(t.auto ? { auto: true } : {}), ...(fd.fund && fd.type === 'expense' ? { fund: fd.fund } : {}), ...(fd.acct ? { acct: fd.acct } : {}) };
      if (isNew) state.tx.push(rec); else state.tx[state.tx.findIndex(x => x.id === t.id)] = rec;
      viewMonth = rec.date.slice(0, 7);
    },
    isNew ? null : () => { state.tx = state.tx.filter(x => x.id !== t.id); });
}

function openFixedSheet(f, type, cat) {
  const isNew = !f;
  f = f || { type: type || 'expense', name: '', amount: '', category: cat || (type === 'income' ? '수익' : type === 'saving' ? '주식·ETF' : '주거/관리비'), day: '' };
  openSheet(`<h2>${isNew ? '고정 항목 추가' : '고정 항목 수정'}</h2>
    ${typeSeg3(f.type)}
    <label>이름</label><input name="name" required value="${esc(f.name)}" placeholder="예: 월세, 넷플릭스, 월급" maxlength="30" />
    <label>월 금액</label><input name="amount" data-money inputmode="numeric" required value="${moneyVal(f.amount)}" placeholder="0" />
    <label>카테고리</label><select name="category">${catOptions(f.type, f.category)}</select>
    <label>매월 (일)</label><input name="day" type="number" min="1" max="31" value="${f.day || ''}" />
    <label>종료 월 <span class="muted">(없으면 비움)</span></label><input name="until" type="month" value="${f.until || ''}" />`,
    fd => {
      const amount = parseAmount(fd.amount);
      if (!amount || !fd.name.trim()) { alert('이름과 금액을 입력하세요'); return false; }
      const rec = { id: f.id || uid(), type: fd.type, name: fd.name.trim(), amount, category: fd.category, day: Number(fd.day) || '', ...(fd.until ? { until: fd.until } : {}), ...(f.inst ? { inst: true } : {}) };
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
    <label>자산 연동</label><select name="link"><option value="">안 함 (직접 입력)</option><option value="net" ${g.link === 'net' ? 'selected' : ''}>순자산 (보증금·부채 포함)</option><option value="fin" ${g.link === 'fin' ? 'selected' : ''}>금융자산 (현금·예적금·투자·코인)</option></select>
    <label>목표 시점</label><input name="deadline" type="month" required value="${g.deadline}" min="${shiftMonth(ym(new Date()), 1)}" />
    <label>연수익률 %</label><input name="rate" type="number" step="0.1" min="0" max="20" value="${g.rate}" />
    <div class="hint">예금 2~3 · 주식 4~6</div>`,
    fd => {
      const target = parseAmount(fd.target);
      if (!target || !fd.name.trim()) { alert('이름과 목표 금액을 입력하세요'); return false; }
      const rec = { id: g.id || uid(), name: fd.name.trim(), target, saved: parseAmount(fd.saved), deadline: fd.deadline, rate: Math.max(0, Number(fd.rate) || 0), ...(fd.link ? { link: fd.link } : {}) };
      if (isNew) state.goals.push(rec); else state.goals[state.goals.findIndex(x => x.id === g.id)] = rec;
      syncLinkedGoals();
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
// 학습한 가맹점 카테고리: 정확히 같은 이름 → 없으면 공백·괄호 무시하고 한쪽이 다른 쪽을 포함(2자 이상)
function learnedCat(memo) {
  const mc = state.merchantCats || {}; if (mc[memo]) return mc[memo];
  const n = normName(memo); if (n.length < 2) return null;
  const k = Object.keys(mc).find(k => { const m = normName(k); return m.length >= 2 && (m.includes(n) || n.includes(m)); });
  return k ? mc[k] : null;
}
function smsItemsFrom(results) {
  return results.map(r => {
    const memo = r.merchant || (r.type === 'income' ? '입금' : '카드 결제');
    const learned = learnedCat(memo);
    const type = r.type === 'cancel' ? 'cancel' : r.type;
    const category = learned && type !== 'cancel' && (type === 'income' ? INCOME_CATS : EXPENSE_CATS).includes(learned) ? learned : r.category;
    const dup = type !== 'cancel' && state.tx.some(t => t.date === r.date && t.amount === r.amount && (t.memo === memo || t.type === type));
    const cancelTarget = type === 'cancel' ? findCancelTarget(r.amount, memo, r.date) : null;
    // 카드로 나가는 구독·통신·보험은 고정 탭에도 있으므로, 같은 결제 문자가 오면 이중 계산이 된다
    const fixedHit = type === 'expense' && state.fixed.find(f => f.type === 'expense' &&
      Math.abs(f.amount - r.amount) <= f.amount * 0.05 &&
      (normName(f.name).slice(0, 2) === normName(memo).slice(0, 2) || (f.day && Math.abs(Number(r.date.slice(8)) - f.day) <= 2)));
    const bill = type === 'expense' ? billMatch(memo) : null;
    const fund = type === 'expense' && !bill ? fundMatch(memo) : null;
    const acct = detectAcct(r.raw || memo, false);
    const extra = { balance: r.balance ?? null, raw: r.raw || '', fundId: fund?.id || '', fundName: fund?.name || '', acct };
    return { type, amount: r.amount, date: r.date, memo, category, dup, fixedHit: fixedHit ? fixedHit.name : '', billId: bill?.id || '', billName: bill?.name || '', ...extra, cancelTarget,
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
      ${it.billId ? `<div class="hint">→ ${esc(it.billName)} ${Number(it.date.slice(5, 7))}월</div>` : it.fundId ? `<div class="hint">💼 ${esc(it.fundName)} 적립금에서</div>` : it.fixedHit ? `<div class="hint">= ${esc(it.fixedHit)}</div>` : ''}
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
  smsItems.forEach(applyBalance); syncLinkedGoals(); // 잔액 알림은 체크 여부와 상관없이 반영
  for (const it of picked) {
    if (it.type === 'cancel') {
      if (it.cancelTarget) { state.tx = state.tx.filter(t => t.id !== it.cancelTarget); removed++; }
      continue;
    }
    if (it.billId && recordBill(it)) { added++; continue; }
    const acct = detectAcct(it.raw || it.memo);
    state.tx.push({ id: uid(), type: it.type, amount: it.amount, category: it.category, memo: it.memo.trim(), date: it.date, ...(it.fundId ? { fund: it.fundId } : {}), ...(acct ? { acct } : {}) });
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
    <button class="sms-cta" data-bill-import><span class="cat-ic" style="--c:var(--gold)">📋</span><span><b>공과금 붙여넣기</b></span><span class="chev">›</span></button>
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
    <label style="display:flex;align-items:center;gap:8px;color:var(--text)"><input type="checkbox" name="replace" style="width:auto"/> 표에 있는 달은 기존 월 합계 전부 교체</label>
    <div id="sumPreview"></div>`,
    fd => {
      if (!rows.length) { alert('인식된 항목이 없어요'); return false; }
      if (fd.replace) { // 정정용: 표에 나온 달의 기존 월 합계를 모두 지우고 새로 넣음
        const ms = new Set(rows.map(r => r.m));
        const n = state.tx.filter(t => t.sum && ms.has(t.date.slice(0, 7))).length;
        if (n && !confirm(`${[...ms].sort().join(', ')}\n기존 월 합계 ${n}건을 지우고 새로 넣을까요?`)) return false;
        state.tx = state.tx.filter(t => !(t.sum && ms.has(t.date.slice(0, 7))));
      }
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
      if (!cat) cat = type === 'income' ? (/급여|월급/.test(ln) ? '수익' : '기타') : type === 'saving' ? savingCat(p.name) : (/주유|기름|지하철|버스|택시|교통|후불/.test(p.name) ? '교통' : SmsParser.guessCategory('expense', p.name, p.name));
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


/* ===================== 자산 ===================== */
// 개인 웹앱은 은행·증권 잔액을 직접 못 읽는다(마이데이터 허가 필요). 대신:
//  ① 입출금 알림의 "잔액"으로 연결된 계좌 잔액 자동 갱신 ② 매월 적립액 자동 가산(추정) ③ 매일 총자산 기록
const ASSET_KINDS = ['현금', '예적금', '투자', '코인', '보증금', '기타자산', '부채'];
const ASSET_ICON = { 현금: '💵', 예적금: '🏦', 투자: '📈', 코인: '🪙', 보증금: '🏠', 기타자산: '💎', 부채: '💳' };
function assetTotals() {
  let a = state.assets || [];
  a = a.filter(x => !x.biz); // 사업용 자산은 1억 목표·순자산에서 제외
  const debt = a.filter(x => x.kind === '부채').reduce((s, x) => s + (x.balance || 0), 0);
  const fin = a.filter(x => !['부채', '보증금'].includes(x.kind)).reduce((s, x) => s + (x.balance || 0), 0);
  const all = a.filter(x => x.kind !== '부채').reduce((s, x) => s + (x.balance || 0), 0);
  return { fin, debt, net: all - debt };
}
// 매월 자동 적립: 적립일이 지난 달마다 한 번씩 더함(accruedTo = 마지막으로 더한 달)
function autoAccrue() {
  const now = new Date(), cur = ym(now); let changed = false;
  for (const a of state.assets || []) {
    if (!a.monthly || !a.accruedTo) continue;
    let m = shiftMonth(a.accruedTo, 1);
    while (m < cur || (m === cur && now.getDate() >= (a.day || 1))) {
      a.balance = (a.balance || 0) + a.monthly; a.accruedTo = m; a.updated = todayStr(); changed = true;
      m = shiftMonth(m, 1);
    }
  }
  return changed;
}
function syncLinkedGoals() {
  const t = assetTotals(); let changed = false;
  for (const g of state.goals) {
    const v = g.link === 'net' ? t.net : g.link === 'fin' ? t.fin : null;
    if (v != null && (state.assets || []).length && g.saved !== v) { g.saved = v; changed = true; }
  }
  return changed;
}
function snapshotDaily() {
  if (!(state.assets || []).length) return false;
  const t = todayStr(), { net, fin } = assetTotals();
  const h = state.settings.netHist || {};
  if (h[t]?.net === net && h[t]?.fin === fin) return false;
  h[t] = { net, fin };
  const keys = Object.keys(h).sort(); keys.slice(0, Math.max(0, keys.length - 400)).forEach(k => delete h[k]);
  state.settings.netHist = h; return true;
}
// 알림 원문에 계좌의 연결 키워드(예: 끝 4자리, '토스뱅크')가 있고 '잔액'이 있으면 그 계좌 잔액 갱신
function applyBalance(it) {
  if (it.balance == null || !it.raw) return false;
  const a = (state.assets || []).find(x => x.match && it.raw.includes(x.match));
  if (!a) return false;
  a.balance = it.balance; a.updated = it.date || todayStr(); return true;
}
function assetsDaily() { const c = autoAccrue() | syncLinkedGoals() | snapshotDaily() | fixIssuerMemos() | renameIncomeCat() | checkEokSteps(); if (c) save(); }
// 사용자 요청: 수입 카테고리 '급여' → '수익'(급여 외 수입도 있어서). 예전 기록·고정 항목·학습값을 옮긴다(동기화로 다른 기기에도 반영)
function renameIncomeCat() {
  let changed = false;
  for (const r of [...state.tx, ...state.fixed]) if (r.type === 'income' && r.category === '급여') { r.category = '수익'; changed = true; }
  for (const f of state.fixed) if (f.type === 'income' && f.name === '급여') { f.name = '수익'; changed = true; }
  const mc = state.merchantCats || {};
  for (const k of Object.keys(mc)) if (mc[k] === '급여') { mc[k] = '수익'; changed = true; }
  return changed;
}
// 예전 해석 오류 보정: '삼성7811승인 … 쿠팡' 알림이 가맹점 '삼성'으로 들어간 것을 수집 기록 원문으로 다시 해석
const ISSUER_ONLY = /^(KB국민|국민|삼성|신한|현대|하나|우리|롯데|농협|기업|씨티|카카오|토스|케이|비씨|BC|NH|IBK)$/;
function fixIssuerMemos() {
  let changed = false;
  const mc = state.merchantCats || {};
  for (const k of Object.keys(mc)) if (ISSUER_ONLY.test(k.trim())) { delete mc[k]; changed = true; } // 잘못 학습된 '삼성' 같은 키 제거
  const bad = state.tx.filter(t => t.auto && ISSUER_ONLY.test(String(t.memo || '').trim()));
  if (!bad.length) return changed;
  const parsed = (state.settings.ingestLog || []).flatMap(x => SmsParser.parseNotifications(x.text).results);
  for (const t of bad) {
    const r = parsed.find(r => r.amount === t.amount && r.date === t.date && r.merchant && !ISSUER_ONLY.test(r.merchant));
    if (!r) continue;
    t.memo = r.merchant;
    if (t.category === '기타' || !t.category) t.category = learnedCat(r.merchant) || r.category || t.category;
    changed = true;
  }
  return changed;
}

function sparkline(points, w = 300, h = 44) {
  if (points.length < 2) return '';
  const vs = points.map(p => p[1]), min = Math.min(...vs), max = Math.max(...vs), span = max - min || 1;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(i / (points.length - 1) * w).toFixed(1)},${(h - 4 - (p[1] - min) / span * (h - 8)).toFixed(1)}`).join('');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="var(--gold)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}
function assetsHtml() {
  const a = state.assets || [], t = assetTotals();
  const hist = Object.entries(state.settings.netHist || {}).sort().slice(-90).map(([d, v]) => [d, v.net]);
  const past = hist.find(([d]) => d >= todayStr().replace(/\d\d$/, '01')) || hist[0];
  const diff = past && hist.length > 1 ? t.net - past[1] : null;
  const order = k => ASSET_KINDS.indexOf(k);
  return `<section class="card">
    <div class="row"><h2>총 자산</h2><button class="btn sm ghost" data-add-asset>＋</button></div>
    <div class="big">${won(t.net)}</div>
    <div class="muted">금융 ${won(t.fin)}${t.debt ? ` · 부채 ${won(t.debt)}` : ''}${diff != null ? ` · 이번 달 ${diff >= 0 ? '▲' : '▼'}${shortWon(Math.abs(diff))}` : ''}</div>
    ${sparkline(hist)}
    ${a.length ? `<ul class="list">${a.slice().sort((x, y) => order(x.kind) - order(y.kind) || (y.balance || 0) - (x.balance || 0)).map(x => `
      <li data-asset="${x.id}"><div class="li-main"><span class="cat-ic bill-ic">${ASSET_ICON[x.kind] || '💎'}</span>
        <div><div class="title">${esc(x.name)}</div><div class="sub">${esc(x.kind)}${x.updated ? ` · ${Number(x.updated.slice(5, 7))}/${Number(x.updated.slice(8))}` : ''}${x.match ? ' · 🔔' : ''}${x.monthly ? ` · +${shortWon(x.monthly)}/월` : ''}</div></div></div>
        <div class="amount ${x.kind === '부채' && x.balance ? 'expense' : ''}">${x.kind === '부채' && x.balance ? '−' : ''}${won(x.balance || 0)}</div></li>`).join('')}</ul>` : `<div class="empty">없음</div>`}
  </section>`;
}
function openAssetSheet(x) {
  const isNew = !x;
  x = x || { name: '', kind: '현금', balance: '', monthly: '', day: '', match: '' };
  openSheet(`<h2>${isNew ? '자산 추가' : esc(x.name)}</h2>
    <div class="grid2">
      <div><label>이름</label><input name="name" required value="${esc(x.name)}" placeholder="예: 토스뱅크" maxlength="20"></div>
      <div><label>종류</label><select name="kind">${ASSET_KINDS.map(k => `<option ${k === x.kind ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
    </div>
    <label>현재 잔액</label><input name="balance" data-money inputmode="numeric" value="${moneyVal(x.balance)}" placeholder="0">
    <div class="grid2">
      <div><label>매월 자동 +</label><input name="monthly" data-money inputmode="numeric" value="${moneyVal(x.monthly)}" placeholder="0"></div>
      <div><label>적립일</label><input name="day" type="number" min="1" max="31" value="${x.day || ''}"></div>
    </div>
    <label>🔔 알림 연결 (끝 4자리 등)</label><input name="match" value="${esc(x.match || '')}" placeholder="예: 5106" maxlength="20">
    <label style="display:flex;align-items:center;gap:8px;color:var(--text)"><input type="checkbox" name="biz" style="width:auto" ${x.biz ? 'checked' : ''}/> 💼 사업용 (목표·순자산 제외)</label>`,
    fd => {
      if (!fd.name.trim()) { alert('이름을 입력하세요'); return false; }
      const now = new Date(), day = Number(fd.day) || '', monthly = parseAmount(fd.monthly), bal = parseAmount(fd.balance);
      const rec = { id: x.id || uid(), name: fd.name.trim(), kind: fd.kind, balance: bal, monthly, day, match: fd.match.trim(), ...(fd.biz ? { biz: true } : {}),
        updated: bal !== x.balance || isNew ? todayStr() : x.updated,
        // 적립 시작점: 잔액을 직접 고친 경우 그 시점부터 다시 계산
        accruedTo: monthly ? ((isNew || bal !== x.balance || !x.accruedTo) ? (now.getDate() >= (day || 1) ? ym(now) : shiftMonth(ym(now), -1)) : x.accruedTo) : '' };
      state.assets = state.assets || [];
      if (isNew) state.assets.push(rec); else state.assets[state.assets.findIndex(a => a.id === x.id)] = rec;
      syncLinkedGoals(); snapshotDaily();
    },
    isNew ? null : () => { state.assets = state.assets.filter(a => a.id !== x.id); syncLinkedGoals(); });
}


/* ===================== 분류 필요 · 카테고리 관리 ===================== */
// '기타'로 들어간 건별 지출(월 합계 제외) → 사용자가 고르고, 같은 가맹점은 학습
const uncategorized = () => state.tx.filter(t => t.type === 'expense' && t.category === '기타' && !t.sum && !isBiz(t));
// 홈 '지출 구성'에서 카테고리를 누르면: 그 기간의 해당 카테고리 내역·가맹점별 합계·전 기간 비교
function openCatSheet(cat, scope = 'month') {
  const y = viewMonth.slice(0, 4);
  const pick = key => state.tx.filter(t => t.type === 'expense' && t.category === cat && !isBiz(t) && t.date.startsWith(key)); // key: 'YYYY-MM' 또는 'YYYY'
  const key = scope === 'year' ? y : viewMonth, prevKey = scope === 'year' ? String(Number(y) - 1) : shiftMonth(viewMonth, -1);
  const list = pick(key).sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount);
  const total = sum(list), prev = sum(pick(prevKey));
  const byM = {};
  list.forEach(t => { const k = t.memo || '–'; const b = (byM[k] = byM[k] || { n: 0, v: 0 }); b.n++; b.v += t.amount; });
  const top = Object.entries(byM).sort((a, b) => b[1].v - a[1].v).slice(0, 5);
  const label = scope === 'year' ? `${y}년` : monthLabel(viewMonth);
  const prevLabel = scope === 'year' ? '작년' : '지난달';
  form.innerHTML = `<div class="row"><h2>${catIcon(cat)} ${esc(cat)}</h2><span class="muted">${label}</span></div>
    <div class="big expense">${won(total)}</div>
    <div class="muted">${list.length}건${prev ? ` · ${prevLabel} ${won(prev)} ${total > prev ? `<b class="expense">▲${shortWon(total - prev)}</b>` : total < prev ? `<b class="income">▼${shortWon(prev - total)}</b>` : '='}` : ''}</div>
    ${scope === 'month' ? eokFasterHint(total) : ''}
    ${top.length > 1 ? `<h3>가맹점</h3><table class="mini">${top.map(([m, b]) => `<tr><td>${esc(m)}${b.n > 1 ? ` <span class="muted">×${b.n}</span>` : ''}</td><td>${won(b.v)}</td></tr>`).join('')}</table>` : ''}
    <h3>내역</h3>
    ${list.length ? `<ul class="list">${list.slice(0, 60).map(t => `<li data-cat-tx="${t.id}"><div class="li-main"><div><div class="title">${esc(t.memo || cat)}${t.sum ? ' <span class="pill">월합계</span>' : ''}</div><div class="sub">${Number(t.date.slice(5, 7))}/${Number(t.date.slice(8))}${acctOf(t) ? ` · ${esc(acctOf(t).name)}` : ''}</div></div></div><div class="amount expense">−${won(t.amount)}</div></li>`).join('')}</ul>${list.length > 60 ? `<div class="hint">최근 60건만 표시</div>` : ''}` : '<div class="empty">기록 없음</div>'}
    <div class="actions"><button type="button" class="btn ghost" data-act="close">닫기</button></div>`;
  form.onsubmit = e => e.preventDefault();
  form.onclick = e => {
    if (e.target.closest('[data-act=close]')) { sheet.close(); return; }
    const li = e.target.closest('[data-cat-tx]'); if (!li) return;
    const t = state.tx.find(x => x.id === li.dataset.catTx); if (!t) return;
    form.onclick = null; sheet.close();
    setTimeout(() => openTxSheet(t), 50); // 내역 수정 화면으로
  };
  sheet.addEventListener('close', () => { form.onclick = null; }, { once: true });
  sheet.showModal();
}
function openClassifySheet() {
  const draw = () => {
    const list = uncategorized().sort((a, b) => b.date.localeCompare(a.date));
    form.innerHTML = `<h2>❓ 분류 필요 ${list.length}</h2>
      ${list.length ? list.slice(0, 30).map(t => `
        <div class="sms-item" data-cls="${t.id}">
          <div class="row"><div><div class="title">${esc(t.memo || '–')}</div><div class="sub">${Number(t.date.slice(5, 7))}/${Number(t.date.slice(8))}</div></div><b class="expense">−${won(t.amount)}</b></div>
          <div class="chips">${EXPENSE_CATS.filter(c => c !== '기타').map(c => `<button type="button" class="chip" data-pick-cat="${esc(c)}" style="--c:${catColor(c)}">${esc(c)}</button>`).join('')}<button type="button" class="chip" data-del-cls style="--c:var(--expense)">🗑 삭제</button></div>
        </div>`).join('') : '<div class="empty">✓</div>'}
      <div class="actions"><button type="button" class="btn ghost" data-act="close">닫기</button></div>`;
  };
  form.onsubmit = e => e.preventDefault();
  form.onclick = e => {
    if (e.target.closest('[data-act=close]')) { sheet.close(); return; }
    const d = e.target.closest('[data-del-cls]');
    if (d) { // 잘못 들어온 내역(중복·결제 아님 등)을 분류 화면에서 바로 삭제
      const t = state.tx.find(x => x.id === d.closest('[data-cls]').dataset.cls); if (!t) return;
      if (!confirm(`${t.memo || '내역'} ${won(t.amount)} 삭제할까요?`)) return;
      state.tx = state.tx.filter(x => x.id !== t.id);
      save(); toast('삭제'); draw(); return;
    }
    const b = e.target.closest('[data-pick-cat]'); if (!b) return;
    const t = state.tx.find(x => x.id === b.closest('[data-cls]').dataset.cls); if (!t) return;
    const cat = b.dataset.pickCat;
    // 같은 가맹점의 다른 미분류도 함께 + 학습
    const same = uncategorized().filter(x => x.memo && x.memo === t.memo);
    (same.length ? same : [t]).forEach(x => { x.category = cat; });
    if (t.memo) { state.merchantCats = state.merchantCats || {}; state.merchantCats[t.memo] = cat; }
    save(); toast(`${cat}${same.length > 1 ? ` · ${same.length}건` : ''}`); draw();
  };
  sheet.addEventListener('close', () => { form.onclick = null; render(); }, { once: true });
  draw(); sheet.showModal();
}

function acctsHtml() {
  const list = accounts();
  const cnt = id => state.tx.filter(t => t.acct === id).length;
  return `<section class="card">
    <div class="row"><h2>🏦 출처</h2><button class="btn sm ghost" data-add-acct>＋</button></div>
    ${list.length ? `<ul class="list">${list.map(a => `<li data-acct="${a.id}"><div class="li-main"><span class="cat-ic" style="--c:${a.biz ? 'var(--muted)' : 'var(--gold)'}">${a.kind === '카드' ? '💳' : a.kind === '페이' ? '📱' : '🏦'}</span><div><div class="title">${esc(a.name)}${a.biz ? ' <span class="pill">💼 사업</span>' : ''}</div><div class="sub">${a.kind} · ${cnt(a.id)}건</div></div></div><span class="chev">›</span></li>`).join('')}</ul>` : '<div class="empty">알림이 오면 자동 추가</div>'}
    <details class="hint"><summary>? 💼 사업용 표시</summary>사업용으로 표시한 계좌·카드의 거래와 자산은 기록만 하고 통계·예산·1억 목표에서 뺌. 사업 계좌에서 내 계좌로 옮긴 돈은 내 계좌에 수입(부수입)으로 기록.</details>
  </section>`;
}
function openAcctSheet(a) {
  const isNew = !a;
  a = a || { name: '', kind: '은행', biz: false, match: '' };
  openSheet(`<h2>${isNew ? '출처 추가' : esc(a.name)}</h2>
    <div class="grid2">
      <div><label>이름</label><input name="name" required value="${esc(a.name)}" placeholder="예: 하나은행" maxlength="20"></div>
      <div><label>종류</label><select name="kind">${['은행', '카드', '페이'].map(k => `<option ${k === a.kind ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
    </div>
    <label>알림 키워드</label><input name="match" value="${esc(a.match || '')}" placeholder="예: 하나, 1234" maxlength="40">
    <label style="display:flex;align-items:center;gap:8px;color:var(--text)"><input type="checkbox" name="biz" style="width:auto" ${a.biz ? 'checked' : ''}/> 💼 사업용 (통계·목표 제외)</label>
    ${isNew ? '' : `<div class="hint">이 출처 거래 ${state.tx.filter(t => t.acct === a.id).length}건</div>`}`,
    fd => {
      if (!fd.name.trim()) { alert('이름을 입력하세요'); return false; }
      const rec = { id: a.id || uid(), name: fd.name.trim(), kind: fd.kind, biz: !!fd.biz, match: fd.match.trim() };
      state.settings.accounts = isNew ? [...accounts(), rec] : accounts().map(x => x.id === a.id ? rec : x);
    },
    isNew ? null : () => { state.settings.accounts = accounts().filter(x => x.id !== a.id); state.tx.forEach(t => { if (t.acct === a.id) delete t.acct; }); });
}
function catsHtml() {
  const cc = state.settings.customCats || {};
  const chip = (c, kind) => `<span class="chip" style="--c:${catColor(c)}">${esc(c)}${(cc[kind] || []).includes(c) && !(kind === 'income' ? BASE_INCOME : BASE_EXPENSE).includes(c) ? ` <button class="x" data-del-cat="${kind}|${esc(c)}">✕</button>` : ''}</span>`;
  return `<section class="card"><h2>카테고리</h2>
    <div class="muted">지출</div><div class="chips">${EXPENSE_CATS.map(c => chip(c, 'expense')).join('')}</div>
    <div class="muted" style="margin-top:8px">수입</div><div class="chips">${INCOME_CATS.map(c => chip(c, 'income')).join('')}</div>
    <div class="row" style="margin-top:10px;gap:6px">
      <select id="newCatKind" style="width:auto"><option value="expense">지출</option><option value="income">수입</option></select>
      <input id="newCatName" maxlength="10" placeholder="새 카테고리">
      <button class="btn sm" id="addCatBtn">＋</button>
    </div></section>`;
}
function addCat() {
  const kind = document.getElementById('newCatKind').value, name = document.getElementById('newCatName').value.trim().replace(/[|]/g, '');
  if (!name) return;
  if ((kind === 'income' ? INCOME_CATS : EXPENSE_CATS).includes(name)) { toast('이미 있음'); return; }
  const cc = state.settings.customCats = { expense: [], income: [], ...(state.settings.customCats || {}) };
  cc[kind] = [...(cc[kind] || []), name];
  refreshCats(); save(); render();
}
function delCat(kind, name) {
  const used = state.tx.filter(t => t.category === name).length + state.fixed.filter(f => f.category === name).length;
  if (!confirm(`'${name}' 삭제?${used ? `\n쓰인 ${used}건은 '기타'로` : ''}`)) return;
  state.tx.forEach(t => { if (t.category === name) t.category = '기타'; });
  state.fixed.forEach(f => { if (f.category === name) f.category = '기타'; });
  const cc = state.settings.customCats || {}; cc[kind] = (cc[kind] || []).filter(c => c !== name);
  state.settings.customCats = cc; refreshCats(); save(); render();
}


/* ===================== 예산 · 월간 리뷰 ===================== */
// 여유 한도 = 수입 − 고정지출(공과금·할부 포함) − 고정 투자. 변동지출(건별 결제)이 이 안에 들어와야 적자가 아니다.
// 예산 기간: 시작일(월급일, 기본 1일)부터 다음 시작일 전날까지. m = 기간이 시작하는 달
/* ===================== 비정기 지출 적립 (YNAB '진짜 지출' 방식) ===================== */
// 자동차세·연간 보험·명절처럼 매달은 아니지만 반드시 오는 지출을 1년치로 잡고 매달 1/12씩 떼어 둔다.
// 적립금 잔액 = 시작 금액 + 월 적립 × 경과 개월 − 적립금으로 낸 지출. (저장하지 않고 매번 계산 → 동기화 충돌 없음)
const fundAnnual = f => (Number(f.amount) || 0) * ((f.months || []).length || 1);
const fundMonthly = f => Math.ceil(fundAnnual(f) / 12 / 1000) * 1000;
const fundsReserve = m => (state.funds || []).filter(f => !f.start || m >= f.start).reduce((a, f) => a + fundMonthly(f), 0);
function fundInfo(f, now = ym(new Date())) {
  const monthly = fundMonthly(f), start = f.start || now;
  const spent = state.tx.filter(t => t.fund === f.id && t.date.slice(0, 7) >= start).reduce((a, t) => a + t.amount, 0);
  const balance = (Number(f.init) || 0) + (now >= start ? monthly * (monthDiff(start, now) + 1) : 0) - spent;
  // 다음 납부 달: 이번 달 포함, 이번 달에 이미 냈으면 그다음
  const paidNow = state.tx.some(t => t.fund === f.id && t.date.startsWith(now));
  let due = null;
  for (let i = paidNow ? 1 : 0; i <= 12 && !due; i++) { const m = shiftMonth(now, i); if ((f.months || []).includes(Number(m.slice(5)))) due = m; }
  const ahead = due ? monthDiff(now, due) : 0;
  const atDue = balance + monthly * ahead;
  return { monthly, balance, spent, due, ahead, short: due ? Math.max(0, (Number(f.amount) || 0) - atDue) : 0 };
}
const fundMatch = memo => (state.funds || []).find(f => String(f.match || f.name).split(',').map(k => normName(k)).filter(Boolean).some(k => normName(memo).includes(k)));
function fundsHtml(now) {
  const list = state.funds || [];
  const total = fundsReserve(now);
  const item = f => {
    const x = fundInfo(f, now);
    return `<li data-fund="${f.id}"><div class="li-main">${catIcon(f.category || '기타')}<div><div class="title">${esc(f.name)}</div>
      <div class="sub">📅 ${(f.months || []).map(n => n + '월').join('·')} · ${shortWon(f.amount)}</div><div class="sub">잔액 ${shortWon(x.balance)}${x.due ? ` · ${x.short ? `<b class="expense">${Number(x.due.slice(5))}월 부족 ${shortWon(x.short)}</b>` : `${Number(x.due.slice(5))}월 ✓`}` : ''}</div></div></div>
      <div class="amount saving">월 ${shortWon(x.monthly)}</div></li>`;
  };
  return `<section class="card">
    <div class="row"><h2>🫙 적립 <span class="h-sum income">${shortWon(total)}</span></h2><button class="btn sm ghost" data-add-fund>＋ 추가</button></div>
    ${list.length ? `<ul class="list">${list.map(item).join('')}</ul>` : `<div class="empty">없음</div>`}
    <details class="hint"><summary>? 적립이란</summary>자동차세·연간 보험·명절·경조사처럼 가끔 오는 큰 지출을 1년치로 잡아 매달 1/12씩 떼어 둠. 파킹통장 하나에 모아 두고, 그 돈으로 낸 지출은 예산에서 빠짐.</details>
  </section>`;
}
function openFundSheet(f) {
  const isNew = !f;
  f = f || { name: '', amount: '', months: [], start: ym(new Date()), init: '', match: '', category: '기타' };
  const mm = f.months || [];
  openSheet(`<h2>💼 ${isNew ? '적립 추가' : '적립 수정'}</h2>
    <div class="chips">${['자동차세', '연간 보험', '명절', '경조사', '여행', '기기 교체'].map(n => `<button type="button" class="chip" data-preset="${n}" style="--c:var(--gold)">${n}</button>`).join('')}</div>
    <label>이름</label><input name="name" required value="${esc(f.name)}" maxlength="30" />
    <label>1회 금액</label><input name="amount" data-money inputmode="numeric" required value="${moneyVal(f.amount)}" placeholder="0" />
    <label>나가는 달</label>
    <div class="mchk">${Array.from({ length: 12 }, (_, i) => `<label><input type="checkbox" name="months" value="${i + 1}" ${mm.includes(i + 1) ? 'checked' : ''}><span>${i + 1}</span></label>`).join('')}</div>
    <label>카테고리</label><select name="category">${catOptions('expense', f.category)}</select>
    <div class="grid2">
      <div><label>모아둔 돈</label><input name="init" data-money inputmode="numeric" value="${moneyVal(f.init)}" placeholder="0" /></div>
      <div><label>시작 월</label><input name="start" type="month" value="${f.start || ym(new Date())}" /></div>
    </div>
    <label>문자 키워드</label><input name="match" value="${esc(f.match || '')}" placeholder="예: 위택스, 자동차세" maxlength="60" />
    <div class="hint" id="fundCalc"></div>`,
    fd => {
      const amount = parseAmount(fd.amount);
      const months = [...form.querySelectorAll('input[name=months]:checked')].map(x => Number(x.value));
      if (!amount || !fd.name.trim()) { alert('이름과 금액을 입력하세요'); return false; }
      if (!months.length) { alert('나가는 달을 고르세요'); return false; }
      const rec = { id: f.id || uid(), name: fd.name.trim(), amount, months, category: fd.category, start: fd.start || ym(new Date()), init: parseAmount(fd.init), match: fd.match.trim() };
      state.funds = state.funds || [];
      if (isNew) state.funds.push(rec); else state.funds[state.funds.findIndex(x => x.id === f.id)] = rec;
    },
    isNew ? null : () => { state.funds = state.funds.filter(x => x.id !== f.id); state.tx.forEach(t => { if (t.fund === f.id) delete t.fund; }); });
  const calc = () => {
    const a = parseAmount(form.querySelector('[name=amount]').value), n = form.querySelectorAll('input[name=months]:checked').length;
    form.querySelector('#fundCalc').textContent = a && n ? `연 ${won(a * n)} → 매달 ${won(fundMonthly({ amount: a, months: Array(n) }))}` : '';
  };
  form.addEventListener('input', calc); calc();
  form.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
    const n = b.dataset.preset, inp = form.querySelector('[name=name]'); inp.value = n;
    const preset = { 자동차세: [6, 12], 명절: [1, 9] }[n]; // 설·추석은 해마다 달이 바뀌므로 확인 필요
    if (preset && !form.querySelector('input[name=months]:checked')) form.querySelectorAll('input[name=months]').forEach(c => { c.checked = preset.includes(Number(c.value)); });
    const cat = { 자동차세: '자동차', '연간 보험': '보험', 명절: '가족·커플', 경조사: '경조사', 여행: '여행', '기기 교체': '쇼핑' }[n];
    if (cat) form.querySelector('[name=category]').value = cat;
    if (n === '자동차세' && !form.querySelector('[name=match]').value) form.querySelector('[name=match]').value = '위택스, 자동차세';
    calc();
  });
}

/* ===================== 반복 결제 자동 감지 ===================== */
// 같은 가맹점에 비슷한 금액(±15%)이 최근 6개월 중 3개월 이상 나가면 '고정으로 등록?' 후보.
// 이미 고정·공과금·적립에 있는 것, 사용자가 ✕로 숨긴 것은 제외.
function recurringCandidates() {
  const now = ym(new Date()), from = shiftMonth(now, -5);
  const hidden = new Set(state.settings.recurHide || []);
  const groups = {};
  for (const t of state.tx) {
    if (t.type !== 'expense' || t.sum || t.fund || isBiz(t) || t.category === '사업' || !t.memo || t.date.slice(0, 7) < from) continue;
    const k = normName(t.memo); if (k.length < 2 || hidden.has(k)) continue;
    (groups[k] = groups[k] || []).push(t);
  }
  const out = [];
  for (const [k, list] of Object.entries(groups)) {
    const byMonth = {};
    list.forEach(t => { const m = t.date.slice(0, 7); (byMonth[m] = byMonth[m] || []).push(t); });
    const ms = Object.keys(byMonth); if (ms.length < 3) continue;
    const amts = list.map(t => t.amount).sort((a, b) => a - b), med = amts[Math.floor(amts.length / 2)];
    const steady = list.filter(t => Math.abs(t.amount - med) <= med * 0.15);
    const steadyMonths = new Set(steady.map(t => t.date.slice(0, 7)));
    if (steadyMonths.size < 3 || steady.length > steadyMonths.size * 1.5) continue; // 한 달에 여러 번(식당·편의점)은 정기 결제 아님
    const memo = list[0].memo;
    if (state.fixed.some(f => f.type === 'expense' && (!f.until || f.until >= now) && (normName(f.name).includes(k) || k.includes(normName(f.name))))) continue;
    if (billMatch(memo) || fundMatch(memo)) continue;
    const days = steady.map(t => Number(t.date.slice(8))).sort((a, b) => a - b);
    const cats = {}; steady.forEach(t => { cats[t.category] = (cats[t.category] || 0) + 1; });
    out.push({ key: k, memo, amount: med, day: days[Math.floor(days.length / 2)], category: Object.entries(cats).sort((a, b) => b[1] - a[1])[0][0], months: steadyMonths.size, txs: steady });
  }
  return out.sort((a, b) => b.amount - a.amount);
}
function openRecurSheet() {
  const draw = () => {
    const list = recurringCandidates();
    form.innerHTML = `<h2>🔁 반복 결제 ${list.length}</h2>
      ${list.length ? list.map(c => `
        <div class="sms-item" data-rk="${esc(c.key)}">
          <div class="row"><div><div class="title">${esc(c.memo)}</div><div class="sub">${esc(c.category)} · 매월 ${c.day}일경 · ${c.months}개월</div></div><b class="expense">${won(c.amount)}</b></div>
          <div class="chips"><button type="button" class="chip" data-r-add style="--c:var(--income)">＋ 고정</button><button type="button" class="chip" data-r-hide style="--c:var(--muted)">✕ 아님</button></div>
        </div>`).join('') : '<div class="empty">✓</div>'}
      <details class="hint"><summary>기준?</summary>최근 6개월 중 3개월 이상, 같은 가맹점에 비슷한 금액(±15%). 고정으로 옮기면 지난 기록은 고정 항목이 대신함(이중 계산 방지).</details>
      <div class="actions"><button type="button" class="btn ghost" data-act="close">닫기</button></div>`;
  };
  form.onsubmit = e => e.preventDefault();
  form.onclick = e => {
    if (e.target.closest('[data-act=close]')) { sheet.close(); return; }
    const box = e.target.closest('[data-rk]'); if (!box) return;
    const c = recurringCandidates().find(x => x.key === box.dataset.rk); if (!c) return;
    if (e.target.closest('[data-r-hide]')) {
      state.settings.recurHide = [...new Set([...(state.settings.recurHide || []), c.key])];
      save(); draw(); return;
    }
    if (e.target.closest('[data-r-add]')) {
      state.fixed.push({ id: uid(), type: 'expense', name: c.memo, amount: c.amount, category: c.category, day: c.day });
      // 고정 항목은 모든 달에 잡히므로, 같은 결제의 기존 기록(실제 기록 월 제외)은 지워 이중 계산을 막는다
      const ids = new Set(c.txs.filter(t => !isActualMonth(t.date.slice(0, 7))).map(t => t.id));
      state.tx = state.tx.filter(t => !ids.has(t.id));
      save(); toast(`고정 등록 · 기록 ${ids.size}건 대체`); draw();
    }
  };
  sheet.addEventListener('close', () => { form.onclick = null; render(); }, { once: true });
  draw(); sheet.showModal();
}

function budgetPeriod(m) {
  const sd = state.settings.budget?.startDay || 1;
  const [y, mo] = m.split('-').map(Number);
  const start = new Date(y, mo - 1, Math.min(sd, new Date(y, mo, 0).getDate()));
  const end = new Date(y, mo, Math.min(sd, new Date(y, mo + 1, 0).getDate())); end.setDate(end.getDate() - 1);
  const f = d => `${ym(d)}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: f(start), to: f(end), days: Math.round((end - start) / 864e5) + 1 };
}
function currentPeriodMonth() { // 오늘이 속한 예산 기간의 시작 달
  const now = new Date(), sd = state.settings.budget?.startDay || 1;
  return now.getDate() >= sd ? ym(now) : shiftMonth(ym(now), -1);
}
function budgetInfo(m = currentPeriodMonth()) {
  // 25일~24일처럼 걸치는 기간이면, 고정 수입·지출·투자는 기간 대부분이 속한 다음 달 기준으로 본다
  const s = monthStats((state.settings.budget?.startDay || 1) > 1 ? shiftMonth(m, 1) : m);
  const room = s.income - s.fixedExpense - s.saving - s.reserve;
  const p = budgetPeriod(m);
  const spent = state.tx.filter(t => t.type === 'expense' && !t.sum && !t.fund && !isBiz(t) && t.category !== '사업' && t.date >= p.from && t.date <= p.to).reduce((a, t) => a + t.amount, 0); // 적립금에서 낸 지출은 예산에서 제외
  const budget = state.settings.budget?.monthly || 0;
  const today = todayStr(), isCur = today >= p.from && today <= p.to;
  const day = isCur ? Math.round((new Date(today) - new Date(p.from)) / 864e5) + 1 : p.days;
  const left = budget - spent;
  return { s, room, spent, budget, left, days: p.days, day, period: p,
    perDay: isCur && budget ? Math.max(0, Math.floor(left / (p.days - day + 1))) : 0,
    projected: day ? Math.round(spent / day * p.days) : spent };
}
function budgetHtml() {
  if (viewMode !== 'month' || viewMonth !== ym(new Date())) return '';
  const b = budgetInfo();
  if (!b.budget) return `<button class="sms-cta" data-budget><span class="cat-ic" style="--c:var(--gold)">💰</span><span><b>생활비 예산 정하기</b><small>한도 ${shortWon(b.room)}</small></span><span class="chev">›</span></button>`;
  const p = Math.min(100, pct(b.spent, b.budget)), over = b.spent > b.budget, warn = !over && p >= 80;
  return `<section class="card" data-budget>
    <div class="row"><h2>💰 생활비 예산 <span class="muted" style="font-weight:400;font-size:12px">${b.period.from.slice(5).replace('-', '/')}~${b.period.to.slice(5).replace('-', '/')}</span></h2><span class="muted">${shortWon(b.spent)} / ${shortWon(b.budget)}</span></div>
    <div class="bar ${over || warn ? 'over' : ''}"><i style="width:${p}%"></i></div>
    <div class="row" style="margin-top:8px"><span class="${over ? 'expense' : 'muted'}">${over ? `⛔ +${shortWon(-b.left)}` : `${shortWon(b.left)} 남음`}</span><b>${over ? '' : `${shortWon(b.perDay)}/일`}</b></div>
    ${b.projected > b.budget && !over ? `<div class="hint">⚠ 월말 예상 ${shortWon(b.projected)}</div>` : ''}
    ${b.budget > b.room ? `<div class="hint">⚠ 한도 ${shortWon(b.room)} 넘음 +${shortWon(b.budget - b.room)}</div>` : ''}
  </section>`;
}
function openBudgetSheet() {
  const b = budgetInfo();
  const past = [1, 2, 3].map(i => monthStats(shiftMonth(ym(new Date()), -i))).filter(s => s.varExpense > 0 && !s.actual);
  const avg = past.length ? Math.round(past.reduce((a, s) => a + s.varExpense, 0) / past.length) : 0;
  const r = n => Math.max(0, Math.round(n / 10000) * 10000);
  openSheet(`<h2>💰 생활비 예산</h2>
    <div class="muted">한도 <b>${won(b.room)}</b></div>
    <div class="grid2">
      <div><label>월 예산</label><input name="monthly" data-money inputmode="numeric" value="${moneyVal(b.budget)}" placeholder="0"></div>
      <div><label>📅 시작일</label><input name="startDay" type="number" min="1" max="28" value="${state.settings.budget?.startDay || 1}"></div>
    </div>
    <div class="chips">
      ${b.s.income > 0 ? `<button type="button" class="chip" data-set="${r(b.s.income * (1 - eokRule()) - b.s.fixedExpense)}" style="--c:var(--gold)">⚖️ 50% 원칙 ${shortWon(r(b.s.income * (1 - eokRule()) - b.s.fixedExpense))}</button>` : ''}
      <button type="button" class="chip" data-set="${r(b.room)}" style="--c:var(--income)">한도 ${shortWon(r(b.room))}</button>
      ${avg ? `<button type="button" class="chip" data-set="${r(avg * 0.8)}" style="--c:var(--gold)">평소×0.8 ${shortWon(r(avg * 0.8))}</button>` : ''}
    </div>
    `,
    fd => { state.settings.budget = { ...(state.settings.budget || {}), monthly: parseAmount(fd.monthly), startDay: Math.min(28, Math.max(1, Number(fd.startDay) || 1)) }; });
  form.querySelectorAll('[data-set]').forEach(c => c.onclick = () => { form.querySelector('[name=monthly]').value = moneyVal(Number(c.dataset.set)); });
}
// 매달 1~7일: 지난달 돌아보기
function reviewHtml() {
  const now = new Date();
  if (viewMode !== 'month' || viewMonth !== ym(now) || now.getDate() > 7) return '';
  const pm = shiftMonth(ym(now), -1), b = budgetInfo(pm), pp = monthStats(shiftMonth(pm, -1));
  const top = Object.entries(b.s.byCat).sort((x, y) => y[1] - x[1]).slice(0, 3);
  return `<section class="card"><h2>📅 지난달 ${Number(pm.slice(5))}월</h2>
    <table class="mini">
      <tr><td>💰 남은 돈</td><td class="${b.s.left < 0 ? 'expense' : 'income'}">${won(b.s.left)}</td></tr>
      ${b.budget ? `<tr><td>🛒 생활비 / 예산</td><td>${won(b.spent)} / ${won(b.budget)} ${b.spent > b.budget ? '⛔' : '✓'}</td></tr>` : ''}
      <tr><td>💸 지출</td><td>${won(b.s.expense)} ${pp.expense ? `${b.s.expense > pp.expense ? '▲' : '▼'}${shortWon(Math.abs(b.s.expense - pp.expense))}` : ''}</td></tr>
      ${top.map(([c, v]) => `<tr><td>${CAT_EMOJI[c] || ''} ${esc(c)}</td><td>${won(v)}</td></tr>`).join('')}
    </table></section>`;
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
    ${heroHtml(`💰 남은 돈 · ${yearRange(ys)}`, ys)}

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

    <section class="card">
      <h2>🛒 생활비 분류</h2>
      ${cats.length ? `
        <div class="donut-wrap">${donut(cats, ys.varExpense)}<div class="donut-center"><span>변동지출</span><b>${shortWon(ys.varExpense)}원</b></div></div>
        <ul class="list cats">${cats.map(([c, v]) => `
          <li data-cat-detail="${esc(c)}" data-scope="year"><div class="li-main">${catIcon(c)}<div><div class="title">${esc(c)}</div><div class="sub">${pct(v, ys.varExpense)}%</div></div></div>
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
  if (b.dataset.tab === currentTab) { window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }); return; } // 같은 탭 다시 누르면 맨 위로
  currentTab = b.dataset.tab;
  window.scrollTo(0, 0);
  render();
});
$('#prevMonth').onclick = () => { selectedDay = null; viewMonth = shiftMonth(viewMonth, viewMode === 'year' ? -12 : -1); render(); };
$('#nextMonth').onclick = () => { selectedDay = null; viewMonth = shiftMonth(viewMonth, viewMode === 'year' ? 12 : 1); render(); };
$('#monthLabel').onclick = () => openPicker();
$('#fab').onclick = () => openTxSheet();

view.addEventListener('click', e => {
  const el = e.target.closest('[data-guide-done],[data-guide-act],[data-profile],[data-biz-goal],[data-theme-set],[data-cat-detail],[data-src],[data-acct],[data-add-acct],[data-ilog],[data-ilog-clear],[data-fund],[data-add-fund],[data-recur],[data-inst-end],[data-budget],[data-classify],[data-pending],[data-del-cat],#addCatBtn,[data-asset],[data-add-asset],[data-month-sum],[data-bill-import],[data-bill-paid],[data-bill],[data-add-bill],[data-bill-migrate],[data-open-month],[data-import-fixed],[data-clear-ended],[data-sms],[data-day],[data-clear-day],[data-edit-tx],[data-edit-fixed],[data-add-fixed],[data-edit-goal],[data-add-goal],[data-goto],#exportBtn,#importBtn,#resetBtn,#updateBtn,#loginBtn,#logoutBtn,#syncBtn,#dropBtn,#coachBtn,[data-copy]');
  if (!el) return;
  if (el.dataset.guideDone) { state.settings.guideDone = { ...(state.settings.guideDone || {}), [el.dataset.guideDone]: todayStr() }; save(); render(); toast('✓ 30일 뒤 다시 확인'); }
  else if (el.dataset.guideAct) { const a = el.dataset.guideAct; if (a === 'profile') openProfileSheet(); else if (a === 'budget') openBudgetSheet(); else if (a === 'classify') openClassifySheet(); else { currentTab = a; render(); window.scrollTo(0, 0); } }
  else if ('profile' in el.dataset) openProfileSheet();
  else if ('bizGoal' in el.dataset) openBizGoalSheet();
  else if (el.dataset.themeSet) { setTheme(el.dataset.themeSet); render(); }
  else if (el.dataset.catDetail) openCatSheet(el.dataset.catDetail, el.dataset.scope);
  else if (el.dataset.src) { txSrc = txSrc === el.dataset.src ? '' : el.dataset.src; render(); }
  else if (el.dataset.acct) openAcctSheet(accounts().find(a => a.id === el.dataset.acct));
  else if ('addAcct' in el.dataset) openAcctSheet();
  else if (el.dataset.ilog) { const x = (state.settings.ingestLog || [])[Number(el.dataset.ilog)]; if (x) openSmsSheet(x.text); }
  else if ('pending' in el.dataset) openPendingSheet();
  else if ('ilogClear' in el.dataset) { state.settings.ingestLog = []; save(); render(); }
  else if (el.dataset.fund) openFundSheet(state.funds.find(f => f.id === el.dataset.fund));
  else if ('addFund' in el.dataset) openFundSheet();
  else if ('recur' in el.dataset) openRecurSheet();
  else if ('instEnd' in el.dataset) {
    // 카드로 산 할부는 산 달에 전액 지출로 기록되므로(문자·월 합계), 고정 할부를 계속 두면 이중 계산이 된다 → 지난달로 끝냄
    const now = ym(new Date()), list = state.fixed.filter(f => isInst(f) && f.until >= now);
    if (list.length && confirm(`할부 ${list.length}건을 이번 달부터 뺄까요?\n(산 달에 이미 지출로 기록됨 · 선결제·완납했을 때도)`)) { list.forEach(f => { f.until = shiftMonth(now, -1); }); save(); render(); toast(`할부 ${list.length}건 정리`); }
  }
  else if ('budget' in el.dataset) openBudgetSheet();
  else if ('classify' in el.dataset) openClassifySheet();
  else if (el.dataset.delCat) { const [k, n] = el.dataset.delCat.split('|'); delCat(k, n); }
  else if (el.id === 'addCatBtn') addCat();
  else if (el.dataset.asset) openAssetSheet(state.assets.find(a => a.id === el.dataset.asset));
  else if ('addAsset' in el.dataset) openAssetSheet();
  else if ('monthSum' in el.dataset) openMonthSumSheet();
  else if ('billImport' in el.dataset) openBillImportSheet();
  else if (el.dataset.billPaid) { const b = state.bills.find(x => x.id === el.dataset.billPaid), m = ym(new Date()); b.paid = { ...(b.paid || {}), [m]: !b.paid?.[m] }; save(); render(); }
  else if (el.dataset.bill) openBillSheet(state.bills.find(x => x.id === el.dataset.bill));
  else if ('addBill' in el.dataset) openBillSheet();
  else if ('billMigrate' in el.dataset) migrateBills();
  else if (el.dataset.openMonth) { viewMode = 'month'; viewMonth = el.dataset.openMonth; selectedDay = null; render(); window.scrollTo(0, 0); }
  else if ('importFixed' in el.dataset) openFixedImportSheet();
  else if ('clearEnded' in el.dataset) {
    const now = ym(new Date());
    if (confirm('끝난 할부를 목록에서 지울까요? (지난 달 통계에서도 빠집니다)')) { state.fixed = state.fixed.filter(f => !isInst(f) || f.until >= now); save(); render(); }
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
assetsDaily();
render();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { assetsDaily(); if (!sheet.open) render(); } });

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

// 스크롤하면 상단 바에 경계선
addEventListener('scroll', () => document.querySelector('.topbar')?.classList.toggle('scrolled', scrollY > 8), { passive: true });
