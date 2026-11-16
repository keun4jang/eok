'use strict';
/*
 * AI 읽기 (Gemini, Firebase AI Logic 경유 — 무료 Spark 플랜).
 * 규칙 파서(parser.js)가 기본이고, 형식이 낯설 때 사용자가 '✨ AI' 버튼으로 요청한다.
 * 결과는 규칙 파서와 같은 모양으로 돌려줘서 미리보기·저장 흐름을 그대로 쓴다.
 * 주의: 입력 원문이 Google 서버로 전송된다(무료 등급은 Google이 서비스 개선에 쓸 수 있음).
 */
(function (root) {
  // 앞에서부터 시도. 혼잡(500/503)·한도(429)·폐기(404)면 다음 모델로. (2026-11: 2.5 계열은 신규 사용자에게 막힘)
const MODELS = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest'];
  let cfgPromise = null;
  const cfg = () => (cfgPromise = cfgPromise || import('./firebase-config.js').then(m => m.default));

  async function call(prompt, schema) {
    const c = await cfg();
    if (!c) throw new Error('AI 설정 없음');
    let lastErr;
    for (const model of MODELS) {
      try {
        const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': c.apiKey };
        const ac = await window.EokSync?.appCheckToken?.().catch(() => null);
        if (ac) headers['X-Firebase-AppCheck'] = ac; // AI Logic은 App Check가 적용돼 있어 토큰 필수
        const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 45000);
        const res = await fetch(`https://firebasevertexai.googleapis.com/v1beta/projects/${c.projectId}/models/${model}:generateContent`, {
          method: 'POST', signal: ctl.signal,
          headers,
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema },
          }),
        });
        const j = await res.json().finally(() => clearTimeout(timer));
        if (!res.ok) { lastErr = new Error(j?.error?.status === 'UNAUTHENTICATED' ? 'AI 인증(App Check) 실패' : j?.error?.status === 'PERMISSION_DENIED' ? 'AI 미설정' : (j?.error?.status === 'RESOURCE_EXHAUSTED' ? 'AI 한도 초과 · 잠시 후' : (j?.error?.message || res.status))); if ([400, 404, 429, 500, 503].includes(res.status)) continue; throw lastErr; }
        const txt = j?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
        return JSON.parse(txt);
      } catch (e) { lastErr = e.name === 'AbortError' ? new Error('AI 응답 지연') : e; if (/미설정|인증/.test(lastErr.message)) throw lastErr; }
    }
    throw lastErr || new Error('AI 실패');
  }

  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const S = (type, extra = {}) => ({ type, ...extra });

  // 고정 항목 목록 → parseFixedList와 같은 모양
  async function parseFixed(text, expenseCats, incomeCats) {
    const schema = S('ARRAY', { items: S('OBJECT', {
      properties: {
        kind: S('STRING', { enum: ['income', 'expense', 'installment', 'saving', 'card'] }),
        name: S('STRING'), amount: S('INTEGER'), day: S('INTEGER', { nullable: true }),
        category: S('STRING'), until: S('STRING', { nullable: true }), guess: S('BOOLEAN'),
      },
      required: ['kind', 'name', 'amount', 'category', 'guess'],
    }) });
    const prompt = `오늘은 ${today()}. 아래 글에서 매달 반복되는 수입·지출 항목만 뽑아 JSON 배열로.
규칙:
- kind: income(급여 등 매달 들어오는 돈) / expense(매달 나가는 지출) / installment(할부) / saving(적금·청약·투자·본인 계좌 이동) / card(카드대금 출금).
- 합계·요약·설명 문장·계좌 잔액·일회성·불규칙 항목은 넣지 말 것.
- amount: 원 단위 정수, 월 금액. 범위·여러 금액이면 가장 최근 값.
- day: 매월 결제·입금일(1~31), 모르면 null. 범위면 마지막 날.
- category: 지출·할부는 [${expenseCats.join(', ')}] 중 하나, 수입은 [${incomeCats.join(', ')}] 중 하나, saving·card는 "기타".
- until: 할부의 마지막 납부 월 "YYYY-MM", 아니면 null. 이번 달 결제도 남은 회차에 포함: 남은 1회면 이번 달(${today().slice(0, 7)}), 남은 2회면 다음 달. 종료일이 적혀 있으면 그 월.
- name: 짧게. 계좌번호·괄호 메모·사람 실명은 빼고 무엇인지 알 수 있게.
- guess: 원문이 추정이라고 했거나 확실하지 않으면 true.
글:
"""
${text.slice(0, 12000)}
"""`;
    const out = await call(prompt, schema);
    return (Array.isArray(out) ? out : []).filter(x => x && x.amount > 0 && x.name).map(x => ({
      kind: x.kind, type: x.kind === 'income' ? 'income' : 'expense', name: String(x.name).slice(0, 30),
      amount: Math.round(x.amount), day: x.day >= 1 && x.day <= 31 ? x.day : '',
      category: (x.kind === 'income' ? incomeCats : expenseCats).includes(x.category) ? x.category : '기타',
      until: /^\d{4}-\d{2}$/.test(x.until || '') ? x.until : '', guess: !!x.guess,
    }));
  }

  // 결제·입출금 알림 → parseNotifications와 같은 모양
  async function parseNotifications(text, expenseCats, incomeCats) {
    const schema = S('ARRAY', { items: S('OBJECT', {
      properties: {
        type: S('STRING', { enum: ['expense', 'income', 'cancel'] }), amount: S('INTEGER'),
        date: S('STRING'), merchant: S('STRING'), category: S('STRING'),
      },
      required: ['type', 'amount', 'date', 'merchant', 'category'],
    }) });
    const prompt = `오늘은 ${today()}. 아래는 카드 승인·은행 입출금 문자나 카카오톡 알림(여러 건일 수 있음)이다. 결제/입출금 건마다 하나씩 JSON 배열로.
규칙:
- type: expense(승인·결제·출금) / income(입금) / cancel(승인취소·결제취소).
- amount: 그 건의 금액(원, 정수). 누적·잔액·한도 금액은 무시.
- date: "YYYY-MM-DD". 연도가 없으면 오늘 기준으로 가장 가까운 과거 날짜.
- merchant: 가맹점 또는 입금자/내용. 카드사명·마스킹된 이름(홍*동)은 넣지 말 것.
- category: 지출·취소는 [${expenseCats.join(', ')}] 중, 수입은 [${incomeCats.join(', ')}] 중 하나.
- 광고·안내 등 결제가 아닌 메시지는 넣지 말 것.
알림:
"""
${text.slice(0, 12000)}
"""`;
    const out = await call(prompt, schema);
    return (Array.isArray(out) ? out : []).filter(x => x && x.amount > 0).map(x => ({
      type: x.type, amount: Math.round(x.amount), date: /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : today(),
      merchant: String(x.merchant || '').slice(0, 30),
      category: (x.type === 'income' ? incomeCats : expenseCats).includes(x.category) ? x.category : '기타',
    }));
  }

  // AI 재무 코치: 요약된 재무 상태 → 우선순위 행동 계획 (실명·계좌번호 없이 집계값만 전송)
  async function advise(snapshot) {
    const schema = S('OBJECT', {
      properties: {
        score: S('INTEGER'), summary: S('STRING'),
        goal: S('OBJECT', { properties: { monthlyNeeded: S('INTEGER'), etaMonths: S('INTEGER', { nullable: true }), verdict: S('STRING') }, required: ['monthlyNeeded', 'verdict'] }),
        actions: S('ARRAY', { items: S('OBJECT', {
          properties: {
            priority: S('INTEGER'), area: S('STRING', { enum: ['비상금', '부채', '지출', '보험', '절세', '투자', '수입', '현금흐름'] }),
            title: S('STRING'), why: S('STRING'), how: S('STRING'), rule: S('STRING'), monthlyImpact: S('INTEGER', { nullable: true }),
          },
          required: ['priority', 'area', 'title', 'why', 'how'],
        }) }),
        warnings: S('ARRAY', { items: S('STRING') }),
        progress: S('STRING', { nullable: true }),
      },
      required: ['score', 'summary', 'goal', 'actions', 'warnings'],
    });
    const prompt = `너는 한국 개인재무 분야 최고 수준의 자산관리 전문가(CFP)다. 아래 사용자 데이터만 근거로, 첫 목표(순자산 1억 등)를 가장 빨리·안전하게 달성하는 실행 계획을 짜라.
원칙:
- 듣기 좋은 말 금지. 숫자 근거로 직설적으로. 데이터에 없는 사실은 가정하지 말고 필요하면 "확인 필요"라고 써라.
- 우선순위: 현금흐름 적자/결제 부족 → 고금리 부채 → 비상금(생활비 3~6개월, 바로 꺼낼 수 있는 곳) → 새는 고정지출(보험·통신·구독·할부) → 절세 계좌 → 투자 효율.
- 한국 제도를 구체적으로 활용: ISA(중개형, 비과세 한도·분리과세), 연금저축·IRP 세액공제, 청년 정책 상품, 국내상장 해외ETF vs 해외 직접투자의 과세·환전 차이, 증권사별 수수료·환전 우대, 정기 매수 위치(어느 계좌·어느 증권사에서 사는 게 유리한지).
- 투자 목록이 있으면 종목 중복(같은 지수 반복), 커버드콜 등 성장기에 불리할 수 있는 상품, 너무 잘게 쪼갠 정기매수를 점검하고 통합안을 제시.
- 보험료가 소득 대비 높으면 중복 보장 점검을 권하되 해지 판단은 보장 확인 후로.
- 세율·한도·상품 조건은 바뀔 수 있으니 수치가 불확실하면 "최신 조건 확인"을 덧붙여라.
- 특정 종목의 단기 등락 예측 금지.
- 할부는 until(마지막 달)을 보고 곧 끝나는 것은 '정리' 대상이 아니라 '새 할부 금지'로 말하라. 조기 상환은 절약이 아니다.
- thisMonth.roomForVariableSpending(수입−고정지출−고정투자)이 변동지출 실적보다 작으면 구조적 적자다. 예산을 얼마로, 무엇을 줄여 맞출지 숫자로 제시하라.
- 사용자 원칙(반드시 따를 것): ① 저축·투자 합계가 지출(고정+생활비) 이상, 즉 수입의 50% 이상 저축이 목표. 못 미치면 얼마가 모자라고 무엇을 줄여 맞출지 숫자로. ② 연금저축·IRP처럼 중도에 꺼내 쓰기 어려운 돈은 소극적으로: 세액공제를 위한 소액만, 비상금·적금·바로 팔 수 있는 투자를 먼저 채운 뒤. 연금 증액을 1순위 행동으로 제안하지 마라. ③ 1억 계산은 수익률 0% 가정(투자 수익은 보너스).
- profile(수입 형태·주거·부양가족·투자 성향·연금 태도·저축 목표 비율)에 맞춰라. 예: 프리랜서·사업이면 비상금 6개월 이상, 안정 성향이면 변동성 큰 상품을 줄이고, 연금 '소극'이면 연금 증액을 권하지 마라. profile이 '미설정'이면 첫 행동으로 '내 상황 설정'을 권하라.
- appGuide는 앱 규칙 엔진이 계산한 할 일 목록이다. 숫자(금액·비율)는 이것과 맞춰라. 같은 말을 반복하지 말고, 사용자 데이터로 더 구체적인 방법(어디서·어떻게)을 보태라. 엔진과 다르게 판단하면 그 이유를 why에 써라.
- previousAdvice가 있으면 그 행동들이 데이터상 실행됐는지 평가해 progress에 쓰고, 이미 반영된 것(예: 종목 정리)은 반복하지 마라.
출력:
- score: 0~100 재무 건강 점수, summary: 2~3문장.
- goal: 목표 달성에 필요한 월 저축·투자액, 현재 페이스 기준 예상 개월수(계산 불가면 null), verdict 한 줄.
- actions: 우선순위 순 5~8개. title은 15자 이내, why는 데이터 근거 1~2문장, how는 구체적 실행 방법(어디서·얼마·언제), rule은 이 판단의 일반 원칙 한 줄(다음에 사용자가 스스로 판단할 수 있게), monthlyImpact는 월 개선 금액(원, 추정 가능할 때만).
- progress: 지난 진단 대비 변화 평가 1~2문장(없으면 null).
- warnings: 위험 신호 0~4개.
사용자 데이터(JSON, 금액 원):
${JSON.stringify(snapshot)}`;
    return call(prompt, schema);
  }

  // 처음 한 번만 전송 동의
  function consent() {
    try { if (localStorage.getItem('eok.aiOk') === '1') return true; } catch {}
    const ok = confirm('입력한 글을 Google AI(Gemini)로 보내 읽습니다.\n무료 등급은 Google이 서비스 개선에 쓸 수 있어요. 계속할까요?');
    if (ok) try { localStorage.setItem('eok.aiOk', '1'); } catch {}
    return ok;
  }

  root.EokAI = { parseFixed, parseNotifications, advise, consent };
})(window);
