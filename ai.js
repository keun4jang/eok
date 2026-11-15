'use strict';
/*
 * AI 읽기 (Gemini, Firebase AI Logic 경유 — 무료 Spark 플랜).
 * 규칙 파서(parser.js)가 기본이고, 형식이 낯설 때 사용자가 '✨ AI' 버튼으로 요청한다.
 * 결과는 규칙 파서와 같은 모양으로 돌려줘서 미리보기·저장 흐름을 그대로 쓴다.
 * 주의: 입력 원문이 Google 서버로 전송된다(무료 등급은 Google이 서비스 개선에 쓸 수 있음).
 */
(function (root) {
  const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']; // 앞에서부터 시도
  let cfgPromise = null;
  const cfg = () => (cfgPromise = cfgPromise || import('./firebase-config.js').then(m => m.default));

  async function call(prompt, schema) {
    const c = await cfg();
    if (!c) throw new Error('AI 설정 없음');
    let lastErr;
    for (const model of MODELS) {
      try {
        const res = await fetch(`https://firebasevertexai.googleapis.com/v1beta/projects/${c.projectId}/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema },
          }),
        });
        const j = await res.json();
        if (!res.ok) { lastErr = new Error(j?.error?.status === 'PERMISSION_DENIED' ? 'AI 미설정' : (j?.error?.status === 'RESOURCE_EXHAUSTED' ? 'AI 한도 초과 · 잠시 후' : (j?.error?.message || res.status))); if (res.status === 404 || res.status === 400) continue; throw lastErr; }
        const txt = j?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
        return JSON.parse(txt);
      } catch (e) { lastErr = e; if (/미설정|한도/.test(e.message)) throw e; }
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
- until: 할부의 마지막 납부 월 "YYYY-MM"(남은 회차로 계산), 아니면 null.
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

  // 처음 한 번만 전송 동의
  function consent() {
    try { if (localStorage.getItem('eok.aiOk') === '1') return true; } catch {}
    const ok = confirm('입력한 글을 Google AI(Gemini)로 보내 읽습니다.\n무료 등급은 Google이 서비스 개선에 쓸 수 있어요. 계속할까요?');
    if (ok) try { localStorage.setItem('eok.aiOk', '1'); } catch {}
    return ok;
  }

  root.EokAI = { parseFixed, parseNotifications, consent };
})(window);
