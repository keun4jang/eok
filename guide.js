'use strict';
/*
 * 길잡이 엔진 (DOM·저장소와 무관한 순수 함수 — node로 테스트 가능).
 * 사용자 상황(profile)과 앱이 계산한 숫자(ctx)를 받아, 지금 할 일을 우선순위 순으로 돌려준다.
 * AI 없이도 동작(무료·오프라인). AI 코치는 이 결과를 받아 설명을 보강한다.
 *
 * ctx = {
 *   income, fixed: { total, byCat:{카테고리:금액} }, saving, pension, etfItems, coinSaving,
 *   variable, varByCat:{카테고리:월평균}, cash, debtHigh, installments:{ sum, endSoon },
 *   goal:{ target, cur, need, pace, deadline } | null, biz:{ net, goal },
 *   recurring, uncategorized, hasAssets
 * }
 * 결과 항목: { id, pri(0 급함 ~ 6 정리), icon, title, why, how, impact(월 금액, 있을 때만), boost(impact를 매달 더 모을 수 있는 돈으로 볼 수 있음), action?, basis, src? }
 * 문구 원칙(사용자 지시): 최대한 짧게. title 2~4낱말, why는 숫자 위주, how는 할 일 한 토막.
 */
(function (root) {
  const DEFAULT_PROFILE = { job: 'salary', home: 'jeonse', dependents: false, risk: 'mid', pension: 'low', saveRate: 50 };

  // 일반적으로 쓰이는 기준(소득 대비). 사람마다 다르므로 '점검 신호'로만 쓴다.
  const BENCH = {
    insurance: 0.08,   // 보험료 소득의 5~10%
    housing: 0.30,     // 주거비(대출이자·월세·관리비) 30% 이내
    telecom: 70000,    // 통신 월 7만 넘으면 요금제 점검
    subscription: 0.03,
  };
  // 근거 표시('숫자마다 출처' 원칙): 항목마다 basis 하나.
  // stat = 공식 통계(SOURCES), rule = 흔히 쓰는 일반 기준(정답 아님), mine = 내 기록으로 계산, plan = 내 설정·억 원칙
  const BASIS = { stat: '통계', rule: '일반 기준', mine: '내 기록', plan: '내 설정' };
  // 공식 통계 원장. 원문 페이지에서 직접 확인한 값만 넣는다. 새 발표가 나오면 값·날짜를 함께 바꿀 것.
  const SOURCES = {
    S1: { label: '평균 가구 흑자율', value: 0.308, show: '30.8%',
      org: '국가데이터처 가계동향조사 2026년 2/4분기', date: '2026-08-27', checked: '2026-11-16',
      url: 'https://eiec.kdi.re.kr/policy/materialView.do?num=285882',
      note: '세후 소득 기준, 평균 2인 이상 가구' },
  };
  const DISCRETIONARY = ['쇼핑', '식비', '배달', '카페/간식', '술·유흥', '문화/여가', '여행', '미용', '생활용품'];

  const man = n => {
    const a = Math.abs(Math.round(n));
    if (a >= 1e8) return `${(a / 1e8).toFixed(a % 1e8 ? 1 : 0)}억`;
    if (a >= 1e4) return `${Math.round(a / 1e4).toLocaleString('ko-KR')}만`;
    return a.toLocaleString('ko-KR');
  };
  const r1 = n => Math.round(n / 10000) * 10000;

  function emergencyMonths(p) {
    let m = p.job === 'salary' ? 3 : 6;           // 수입이 불규칙하면 더 길게
    if (p.dependents) m += 2;
    return m;
  }

  function build(ctx, profileIn) {
    const p = Object.assign({}, DEFAULT_PROFILE, profileIn || {});
    const out = [];
    const add = it => out.push(it);
    const inc = ctx.income || 0;
    const fx = (ctx.fixed && ctx.fixed.byCat) || {};
    const fixedTotal = (ctx.fixed && ctx.fixed.total) || 0;
    const monthlySpend = fixedTotal + (ctx.variable || 0);

    if (!profileIn) add({ id: 'profile', pri: 0, icon: '👤', title: '내 상황 설정', why: '추천이 나에게 맞춰짐', how: '버튼 6개', action: 'profile' });
    if (!(inc > 0)) { add({ id: 'income', pri: 0, icon: '💵', title: '수익 등록', why: '비율 계산에 필요', how: '고정 → 수입 ＋', action: 'fixed' }); return finish(out); }

    // 1) 매달 적자
    const left = inc - fixedTotal - (ctx.saving || 0) - (ctx.variable || 0);
    if (left < -10000) add({ id: 'deficit', pri: 1, icon: '⛔', title: '매달 적자',
      why: `수익 ${man(inc)} − 고정 ${man(fixedTotal)} − 저축 ${man(ctx.saving || 0)} − 생활 ${man(ctx.variable || 0)}`,
      how: `생활비 ${man(Math.max(0, inc - fixedTotal - (ctx.saving || 0)))} 안으로`, impact: -left, action: 'budget' });

    if (ctx.debtHigh) add({ id: 'debt', pri: 1, icon: '🔥', title: '고금리 빚 먼저', why: '이자 > 투자 수익', how: '상환 먼저, 새 할부 ✕' });

    // 2) 비상금
    const emM = emergencyMonths(p), emTarget = r1(monthlySpend * emM);
    if (!ctx.hasAssets) add({ id: 'assets', pri: 2, icon: '🏦', title: '잔액 등록', why: '비상금 계산에 필요', how: '목표 → 자산 ＋', action: 'goals' });
    else if (emTarget > 0 && (ctx.cash || 0) < emTarget) {
      const gap = emTarget - (ctx.cash || 0), per = Math.min(gap, Math.max(100000, r1(inc * 0.1)));
      // 2년 넘게 걸리면 지치므로, 먼저 생활비 1개월치를 단계 목표로
      const step = Math.ceil(gap / per) > 24 && (ctx.cash || 0) < monthlySpend ? r1(monthlySpend - (ctx.cash || 0)) : 0;
      add({ id: 'emergency', pri: 2, icon: '🛟', title: '비상금',
        why: `${man(ctx.cash || 0)} / ${man(emTarget)} (${emM}개월)`,
        how: step ? `1개월치 먼저, ${Math.ceil(step / per)}개월` : `${Math.ceil(gap / per)}개월, 투자 ✕`, impact: per });
    } else if (emTarget > 0 && ctx.cash > emTarget * 1.5) {
      add({ id: 'idle', pri: 5, icon: '💤', title: '노는 현금', why: `비상금보다 ${man(ctx.cash - emTarget)} 많음`, how: p.risk === 'safe' ? '적금·예금' : '적금·ETF' });
    }

    // 3) 저축 비율 (사용자가 정한 비율, 앱 기본 50% = 억 원칙)
    const rate = (ctx.saving || 0) / inc, want = (p.saveRate || 50) / 100;
    if (rate < want - 0.02 && !(left < -10000)) { // 적자면 위 항목(생활비 줄이기)이 먼저 — 서로 반대로 들리지 않게
      const gap = r1(inc * want - (ctx.saving || 0));
      add({ id: 'saverate', pri: 2, icon: '📈', title: `저축 ${Math.round(rate * 100)}% → ${p.saveRate}%`,
        why: `평균 가구 ${SOURCES.S1.show}`, how: '월급날 자동이체 먼저', impact: gap, boost: true, action: 'budget', basis: 'stat', src: 'S1' });
    }

    // 4) 고정비 점검 (일반 기준 대비)
    const ins = fx['보험'] || 0;
    if (ins > inc * BENCH.insurance) add({ id: 'insurance', pri: 3, icon: '🛡️', title: `보험 ${Math.round(ins / inc * 100)}%`,
      why: '기준 5~10%', how: '겹친 특약부터, 새 가입 전 해지 ✕', impact: r1(ins - inc * BENCH.insurance), boost: true });
    const tel = fx['통신'] || 0;
    if (tel > BENCH.telecom) add({ id: 'telecom', pri: 3, icon: '📱', title: '통신비', why: `월 ${man(tel)}`, how: '요금제·알뜰폰', impact: r1(tel - BENCH.telecom), boost: true });
    const housing = (fx['대출이자'] || 0) + (fx['주거/관리비'] || 0);
    if (housing > inc * BENCH.housing) add({ id: 'housing', pri: 3, icon: '🏠', title: `주거비 ${Math.round(housing / inc * 100)}%`,
      why: '기준 30%', how: p.home === 'jeonse' ? '대출 금리 비교·대환' : '다음 계약 때 낮추기' });
    const sub = fx['구독'] || 0;
    if (sub > Math.max(30000, inc * BENCH.subscription)) add({ id: 'subs', pri: 4, icon: '🔁', title: '구독', why: `월 ${man(sub)}`, how: '안 쓰는 것 해지', impact: r1(sub / 2), boost: true });

    // 5) 생활비 — 큰 재량 지출 2개
    const vc = Object.entries(ctx.varByCat || {}).filter(([c]) => DISCRETIONARY.includes(c)).sort((a, b) => b[1] - a[1]).slice(0, 2);
    for (const [c, v] of vc) {
      if (v < Math.max(100000, inc * 0.05)) continue;
      add({ id: `cat:${c}`, pri: 4, icon: '✂️', title: c, why: `월 ${man(v)} · 수익의 ${Math.round(v / inc * 100)}%`,
        how: c === '쇼핑' ? '48시간 뒤 결제' : c === '식비' || c === '배달' ? '배달 주 n회' : '월 한도',
        impact: r1(v * 0.3), boost: true });
    }

    // 6) 할부 — 끝나는 돈은 저축으로
    if (ctx.installments && ctx.installments.sum > 0) add({ id: 'installment', pri: 4, icon: '🧾', title: '할부',
      why: `월 ${man(ctx.installments.sum)}${ctx.installments.endSoon ? ` · 곧 끝 ${man(ctx.installments.endSoon)}` : ''}`,
      how: '끝난 만큼 저축으로', impact: ctx.installments.endSoon || 0, boost: !!ctx.installments.endSoon });

    // 7) 목표 기한
    const g = ctx.goal;
    if (g && g.deadline && g.cur < g.target && g.need > 0) {
      const maxSave = inc - fixedTotal - inc * 0.15; // 생활비를 수익의 15%까지 줄여도
      if (g.need > maxSave) add({ id: 'deadline', pri: 3, icon: '⏰', title: '기한 빠듯',
        why: `필요 월 ${man(g.need)} · 최대 ${man(Math.max(0, maxSave))}`,
        how: `기한 늦추기 or 부업 월 ${man(g.need - Math.max(0, maxSave))}`, action: 'goals' });
    }
    if (ctx.biz && ctx.biz.goal > 0 && ctx.biz.net < ctx.biz.goal) add({ id: 'biz', pri: 4, icon: '💼', title: '사업 순수익',
      why: `${man(ctx.biz.net)} / ${man(ctx.biz.goal)}`, how: '순수익 기준으로 시간 쓰기', impact: ctx.biz.goal - ctx.biz.net, boost: true });

    // 8) 투자 구조 (프로필 반영)
    if (p.pension === 'low' && ctx.pension > (ctx.saving || 0) * 0.2) add({ id: 'pension', pri: 5, icon: '🔒', title: '연금 비중 큼',
      why: `월 ${man(ctx.pension)} · 바로 못 씀`, how: '세액공제용 소액만' });
    if (p.pension === 'normal' && !(ctx.pension > 0) && rate >= 0.3 && (ctx.cash || 0) >= emTarget) add({ id: 'pension-start', pri: 5, icon: '🌱', title: '연금 세액공제',
      why: '비상금·저축률 충분', how: '한도 안 소액' });
    if ((ctx.etfItems || 0) >= 5) add({ id: 'etf', pri: 5, icon: '🧺', title: `투자 ${ctx.etfItems}종목`, why: '같은 지수 중복', how: '1~2개로 합치기' });
    if (p.risk === 'safe' && ctx.coinSaving > 0) add({ id: 'coin', pri: 5, icon: '🪙', title: '코인 적립', why: '안정 성향과 안 맞음', how: '적금·채권형' });

    // 9) 정리
    if (ctx.recurring > 0) add({ id: 'recurring', pri: 6, icon: '🔁', title: `반복 결제 ${ctx.recurring}건`, why: '고정 등록 대기', how: '고정 → 반복 결제', action: 'fixed' });
    if (ctx.uncategorized > 0) add({ id: 'classify', pri: 6, icon: '❓', title: `분류 ${ctx.uncategorized}건`, why: '어디서 새는지 보임', how: '홈 → 분류', action: 'classify' });

    return finish(out);
  }
  // 항목별 근거 종류(위에서 basis를 직접 준 항목은 그대로)
  const ID_BASIS = {
    profile: 'plan', income: 'mine', deficit: 'mine', debt: 'rule', assets: 'mine', emergency: 'rule', idle: 'rule',
    insurance: 'rule', telecom: 'rule', housing: 'rule', subs: 'mine', cat: 'mine', installment: 'mine',
    deadline: 'mine', biz: 'plan', pension: 'plan', 'pension-start': 'rule', etf: 'rule', coin: 'plan', recurring: 'mine', classify: 'mine',
  };
  function finish(out) {
    out.forEach(it => { if (!it.basis) it.basis = ID_BASIS[it.id.split(':')[0]] || 'mine'; });
    return out.sort((a, b) => a.pri - b.pri || (b.impact || 0) - (a.impact || 0));
  }

  const api = { build, emergencyMonths, DEFAULT_PROFILE, BENCH, BASIS, SOURCES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Guide = api;
})(typeof window !== 'undefined' ? window : globalThis);
