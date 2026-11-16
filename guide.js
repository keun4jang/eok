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
 * 결과 항목: { id, pri(0 급함 ~ 6 정리), icon, title, why, how, impact(월 금액, 있을 때만), boost(impact를 매달 더 모을 수 있는 돈으로 볼 수 있음), action? }
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

    if (!profileIn) add({ id: 'profile', pri: 0, icon: '👤', title: '내 상황 설정', why: '수입 형태·주거·부양·투자 성향에 따라 비상금 기준과 추천이 달라짐', how: '30초, 버튼만 누르면 됨', action: 'profile' });
    if (!(inc > 0)) { add({ id: 'income', pri: 0, icon: '💵', title: '수익 등록', why: '수익이 없으면 비율을 계산할 수 없음', how: '고정 탭 → 수입 ＋', action: 'fixed' }); return finish(out); }

    // 1) 매달 적자
    const left = inc - fixedTotal - (ctx.saving || 0) - (ctx.variable || 0);
    if (left < -10000) add({ id: 'deficit', pri: 1, icon: '⛔', title: `매달 ${man(-left)}원 적자`,
      why: `수익 ${man(inc)} − 고정비 ${man(fixedTotal)} − 저축 ${man(ctx.saving || 0)} − 생활비 ${man(ctx.variable || 0)}`,
      how: `생활비를 ${man(Math.max(0, inc - fixedTotal - (ctx.saving || 0)))}원 안으로(저축은 유지). 당장 어렵다면 적금은 두고 투자만 잠시 멈춤`, impact: -left, action: 'budget' });

    if (ctx.debtHigh) add({ id: 'debt', pri: 1, icon: '🔥', title: '고금리 빚부터', why: '카드론·현금서비스·리볼빙 이자는 어떤 투자 수익보다 큼', how: '저축·투자보다 상환 먼저, 새 할부·리볼빙 금지' });

    // 2) 비상금
    const emM = emergencyMonths(p), emTarget = r1(monthlySpend * emM);
    if (!ctx.hasAssets) add({ id: 'assets', pri: 2, icon: '🏦', title: '통장 잔액 등록', why: '비상금이 얼마인지 알아야 다음 단계를 정함', how: '목표 탭 → 총 자산 ＋ (현금·예적금)', action: 'goals' });
    else if (emTarget > 0 && (ctx.cash || 0) < emTarget) {
      const gap = emTarget - (ctx.cash || 0), per = Math.min(gap, Math.max(100000, r1(inc * 0.1)));
      // 2년 넘게 걸리면 지치므로, 먼저 생활비 1개월치를 단계 목표로
      const step = Math.ceil(gap / per) > 24 && (ctx.cash || 0) < monthlySpend ? r1(monthlySpend - (ctx.cash || 0)) : 0;
      add({ id: 'emergency', pri: 2, icon: '🛟', title: `비상금 ${man(gap)}원 부족`,
        why: `${p.job === 'salary' ? '월급' : '불규칙 수입'}${p.dependents ? '·부양 있음' : ''} 기준 생활비 ${emM}개월(${man(emTarget)}) 필요, 지금 현금 ${man(ctx.cash || 0)}`,
        how: step ? `먼저 1개월치(${man(step)}원 더)부터: 월 ${man(per)}원씩 → 약 ${Math.ceil(step / per)}개월. 이 돈은 투자하지 않음`
          : `월 ${man(per)}원씩 입출금 통장에 따로 → 약 ${Math.ceil(gap / per)}개월. 이 돈은 투자하지 않음`, impact: per });
    } else if (emTarget > 0 && ctx.cash > emTarget * 1.5) {
      add({ id: 'idle', pri: 5, icon: '💤', title: `노는 현금 ${man(ctx.cash - emTarget)}원`, why: `비상금 기준(${man(emTarget)})보다 많음`, how: p.risk === 'safe' ? '적금·예금으로' : '적금이나 분산 ETF로' });
    }

    // 3) 저축 비율 (사용자가 정한 비율, 앱 기본 50% = 억 원칙)
    const rate = (ctx.saving || 0) / inc, want = (p.saveRate || 50) / 100;
    if (rate < want - 0.02 && !(left < -10000)) { // 적자면 위 항목(생활비 줄이기)이 먼저 — 서로 반대로 들리지 않게
      const gap = r1(inc * want - (ctx.saving || 0));
      add({ id: 'saverate', pri: 2, icon: '🏁', title: `저축 ${Math.round(rate * 100)}% → ${p.saveRate}%`,
        why: `목표 비율까지 월 ${man(gap)}원 모자람`, how: '월급날 저축을 먼저 자동이체 → 남은 돈으로 생활(선저축)', impact: gap, boost: true, action: 'budget' });
    }

    // 4) 고정비 점검 (일반 기준 대비)
    const ins = fx['보험'] || 0;
    if (ins > inc * BENCH.insurance) {
      const over = r1(ins - inc * BENCH.insurance);
      add({ id: 'insurance', pri: 3, icon: '🛡️', title: `보험 ${Math.round(ins / inc * 100)}% (월 ${man(ins)})`,
        why: `흔히 쓰는 기준은 수익의 5~10%`, how: '보장 겹치는지 확인 → 같은 회사에서 필요 없는 특약부터 줄이기. 새 보험 가입 전 해지 금지', impact: over, boost: true });
    }
    const tel = fx['통신'] || 0;
    if (tel > BENCH.telecom) add({ id: 'telecom', pri: 3, icon: '📱', title: `통신 월 ${man(tel)}`,
      why: '기기 할부·부가서비스가 섞였는지 확인', how: '요금제 낮추기·알뜰폰·결합 할인 비교', impact: r1(tel - BENCH.telecom), boost: true });
    const housing = (fx['대출이자'] || 0) + (fx['주거/관리비'] || 0);
    if (housing > inc * BENCH.housing) add({ id: 'housing', pri: 3, icon: '🏠', title: `주거비 ${Math.round(housing / inc * 100)}%`,
      why: '수익의 30%를 넘으면 다른 걸 줄여도 버티기 어려움', how: p.home === 'jeonse' ? '전세대출 금리 비교·대환, 중도상환 가능 여부 확인' : '다음 계약 때 주거비 낮추기 검토' });
    const sub = fx['구독'] || 0;
    if (sub > Math.max(30000, inc * BENCH.subscription)) add({ id: 'subs', pri: 4, icon: '🔁', title: `구독 월 ${man(sub)}`, why: '한 달 안 쓴 구독은 해지', how: '필요할 때 다시 가입', impact: r1(sub / 2), boost: true });

    // 5) 생활비 — 큰 재량 지출 2개
    const vc = Object.entries(ctx.varByCat || {}).filter(([c]) => DISCRETIONARY.includes(c)).sort((a, b) => b[1] - a[1]).slice(0, 2);
    for (const [c, v] of vc) {
      if (v < Math.max(100000, inc * 0.05)) continue;
      const cut = r1(v * 0.3);
      add({ id: `cat:${c}`, pri: 4, icon: '✂️', title: `${c} 월 ${man(v)}`, why: `수익의 ${Math.round(v / inc * 100)}%`,
        how: c === '쇼핑' ? '장바구니 48시간 뒤 결제, 월 한도 정하기' : c === '식비' || c === '배달' ? '배달 횟수 상한(주 n회), 장보기 비중 늘리기' : '횟수·금액 상한 정하기',
        impact: cut, boost: true });
    }

    // 6) 할부 — 끝나는 돈은 저축으로
    if (ctx.installments && ctx.installments.sum > 0) add({ id: 'installment', pri: 4, icon: '🧾', title: `할부 월 ${man(ctx.installments.sum)}`,
      why: ctx.installments.endSoon ? `곧 끝나는 할부 월 ${man(ctx.installments.endSoon)}` : '할부는 미래 월급을 당겨 쓰는 것',
      how: '새 할부 금지. 끝난 만큼 그대로 저축 자동이체로 돌리기', impact: ctx.installments.endSoon || 0, boost: !!ctx.installments.endSoon });

    // 7) 목표 기한
    const g = ctx.goal;
    if (g && g.deadline && g.cur < g.target && g.need > 0) {
      const maxSave = inc - fixedTotal - inc * 0.15; // 생활비를 수익의 15%까지 줄여도
      if (g.need > maxSave) add({ id: 'deadline', pri: 3, icon: '⏰', title: '목표 기한이 너무 빠듯',
        why: `월 ${man(g.need)}원 필요, 생활비를 극단적으로 줄여도 ${man(Math.max(0, maxSave))}원`,
        how: `기한을 늦추거나 부업 순수익 월 ${man(g.need - Math.max(0, maxSave))}원 만들기`, action: 'goals' });
    }
    if (ctx.biz && ctx.biz.goal > 0 && ctx.biz.net < ctx.biz.goal) add({ id: 'biz', pri: 4, icon: '💼', title: `사업 순수익 ${man(ctx.biz.net)} / ${man(ctx.biz.goal)}`,
      why: '이번 달 목표까지 남음', how: '매출보다 남는 돈(순수익) 기준으로 시간 배분', impact: ctx.biz.goal - ctx.biz.net, boost: true });

    // 8) 투자 구조 (프로필 반영)
    if (p.pension === 'low' && ctx.pension > (ctx.saving || 0) * 0.2) add({ id: 'pension', pri: 5, icon: '🔒', title: `연금 월 ${man(ctx.pension)}`,
      why: '중도 인출이 어려운 돈 — 비상금·적금을 먼저', how: '세액공제용 소액만 남기고 나머지는 적금·바로 팔 수 있는 투자로' });
    if (p.pension === 'normal' && !(ctx.pension > 0) && rate >= 0.3 && (ctx.cash || 0) >= emTarget) add({ id: 'pension-start', pri: 5, icon: '🌱', title: '연금저축 세액공제',
      why: '비상금이 있고 저축률이 충분하면 세금 혜택 계좌 활용', how: '연말정산 세액공제 한도 안에서 소액부터 (조건은 최신 확인)' });
    if ((ctx.etfItems || 0) >= 5) add({ id: 'etf', pri: 5, icon: '🧺', title: `투자 ${ctx.etfItems}종목으로 쪼개짐`, why: '같은 지수를 여러 번 사는 경우가 많음', how: '대표 지수 1~2개로 합치기' });
    if (p.risk === 'safe' && ctx.coinSaving > 0) add({ id: 'coin', pri: 5, icon: '🪙', title: '안정 성향인데 코인 적립', why: '변동이 매우 큼', how: '적립 멈추고 적금·채권형으로' });

    // 9) 정리
    if (ctx.recurring > 0) add({ id: 'recurring', pri: 6, icon: '🔁', title: `반복 결제 ${ctx.recurring}건`, why: '고정으로 등록하면 계산이 정확해짐', how: '고정 탭 → 반복 결제', action: 'fixed' });
    if (ctx.uncategorized > 0) add({ id: 'classify', pri: 6, icon: '❓', title: `분류 필요 ${ctx.uncategorized}건`, why: '분류해야 어디서 새는지 보임', how: '홈 → 분류 필요', action: 'classify' });

    return finish(out);
  }
  function finish(out) {
    return out.sort((a, b) => a.pri - b.pri || (b.impact || 0) - (a.impact || 0));
  }

  const api = { build, emergencyMonths, DEFAULT_PROFILE, BENCH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Guide = api;
})(typeof window !== 'undefined' ? window : globalThis);
