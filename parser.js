'use strict';
/*
 * 결제/입출금 알림 파서 — 문자(SMS)와 카카오톡 알림톡 모두 처리.
 *
 * 카드사·은행마다 형식이 다르고 수시로 바뀌므로 회사별 템플릿 대신 두 단계로 읽는다.
 *  1) 라벨 방식:  "승인금액 : 12,500원", "가맹점명: 스타벅스", "이용일시 11/15 12:34"  (알림톡에 흔함)
 *  2) 휴리스틱:   라벨이 없으면 금액·날짜·카드사명·마스킹 이름 등을 걷어내고 남은 글자를 가맹점으로 본다 (문자에 흔함)
 * 완벽할 수 없으므로 앱에서는 항상 미리보기에서 사람이 확인·수정한 뒤 저장한다.
 */
(function (root) {
  const LABEL_SEP = '\\s*[:：]?\\s*';
  const BULLET = /^[\s■□▶▷►•·\-*※◆◇○●]+/;
  const NUM = '(-?[\\d,]+)';

  const IGNORE_AMOUNT_BEFORE = /(누적|잔액|잔고|한도|결제\s*예정|포인트|적립|가용|이용\s*가능)\s*(금액)?\s*[:：]?\s*$/;

  const LABELS = {
    amount: /^(승인|이용|결제|사용|거래|출금|입금|이체|취소|송금)?\s*(금액|액)$|^(입금액|출금액|이체금액|송금액|금액)$/,
    merchant: /^(가맹점|가맹점명|사용처|이용처|이용가맹점|상호|상호명|결제처|거래처|보낸\s*분|보내신\s*분|받는\s*분|입금자|입금자명|송금인|적요|내용|거래내용|사용내역)$/,
    date: /^(승인|이용|거래|결제|사용|입금|출금)?\s*(일시|일자|날짜|시간|시각)$/,
  };

  const INCOME_WORDS = /(입금|급여|월급|이자\s*지급|환급|받으셨|받았|송금\s*받|입금되)/;
  const EXPENSE_WORDS = /(승인|결제|사용|출금|이체\s*출금|체크|자동이체|납부)/;
  const CANCEL_WORDS = /(승인\s*취소|결제\s*취소|취소\s*승인|매입\s*취소|취소)/;

  // 가맹점 키워드 → 카테고리 (대략적인 추정, 사용자가 고친 결과는 앱에서 학습해 우선 적용)
  const CATEGORY_RULES = [
    [/스타벅스|투썸|이디야|메가.?커피|메가엠지씨|빽다방|컴포즈|폴바셋|할리스|커피|카페|베이커리|파리바게|뚜레쥬르|배스킨|설빙|디저트|GS25|지에스25|CU|씨유|세븐일레븐|이마트24|미니스톱|편의점/i, '카페/간식'],
    [/배달의민족|배민|요기요|쿠팡이츠|땡겨요|식당|김밥|치킨|버거|맥도날드|롯데리아|맘스터치|피자|국밥|분식|한식|중식|일식|초밥|고기|푸드|키친|마트|이마트|홈플러스|롯데마트|노브랜드|코스트코|컬리|하나로/i, '식비'],
    [/택시|카카오\s*T|카카오모빌리티|티머니|버스|지하철|코레일|SRT|고속|주유|칼텍스|SK에너지|S-?OIL|오일뱅크|주차|하이패스|쏘카|그린카/i, '교통'],
    [/넷플릭스|NETFLIX|유튜브|YOUTUBE|멜론|지니|스포티파이|티빙|웨이브|왓챠|쿠팡플레이|디즈니|애플|APPLE|구글|GOOGLE|ChatGPT|OPENAI|구독/i, '구독'],
    [/CGV|메가박스|롯데시네마|영화|공연|티켓|인터파크|예스24|교보|서점|노래|PC방|볼링|헬스|필라테스|여행|호텔|숙박|야놀자|여기어때|에어비앤비/i, '문화/여가'],
    [/올리브영|무신사|29CM|지그재그|에이블리|쿠팡|11번가|G마켓|지마켓|옥션|네이버페이|SSG|신세계|롯데백화점|현대백화점|다이소|유니클로|자라|ZARA|H&M|백화점|아울렛/i, '쇼핑'],
    [/병원|의원|약국|치과|한의원|안과|피부과|정형외과|내과/i, '의료'],
    [/SKT|SK텔레콤|KT|LG\s*U\+|엘지유플러스|알뜰폰|통신/i, '통신'],
    [/관리비|전기|가스|수도|도시가스|한전/i, '주거/관리비'],
    [/보험|생명|화재|손해/i, '보험'],
    [/학원|교육|강의|클래스|인강/i, '교육'],
  ];
  const INCOME_RULES = [
    [/급여|월급|상여/, '급여'],
    [/이자|배당/, '이자/배당'],
  ];

  function guessCategory(type, merchant, text) {
    if (type === 'income') {
      for (const [re, c] of INCOME_RULES) if (re.test(merchant) || re.test(text)) return c;
      return '기타';
    }
    for (const [re, c] of CATEGORY_RULES) if (re.test(merchant)) return c;
    return '기타';
  }

  const toNum = s => Number(String(s).replace(/[^\d]/g, '')) || 0;
  const pad = n => String(n).padStart(2, '0');

  /* ---------- 날짜 ---------- */
  function parseDate(text, now) {
    let y, m, d, mt;
    if ((mt = text.match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/))) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
    else if ((mt = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/))) { m = +mt[1]; d = +mt[2]; }
    else if ((mt = text.match(/(?:^|[^\d])(\d{1,2})[/.\-](\d{1,2})(?![\d/.\-]*\d{3})/))) { m = +mt[1]; d = +mt[2]; }
    if (!m || m < 1 || m > 12 || d < 1 || d > 31) return null;
    if (!y) {
      y = now.getFullYear();
      // 연도가 없는데 미래 날짜가 되면 작년 문자로 본다 (예: 1월에 12월 문자 붙여넣기)
      const cand = new Date(y, m - 1, d);
      if (cand - now > 2 * 864e5) y -= 1;
    }
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  /* ---------- 금액 ---------- */
  function findAmount(text) {
    // 1순위: "숫자원" 중 누적/잔액/한도 바로 뒤가 아닌 첫 번째
    const re = /([\d]{1,3}(?:,\d{3})+|\d+)\s*원/g;
    let mt;
    while ((mt = re.exec(text))) {
      const before = text.slice(Math.max(0, mt.index - 12), mt.index);
      if (IGNORE_AMOUNT_BEFORE.test(before)) continue;
      const n = toNum(mt[1]);
      if (n > 0) return n;
    }
    // 2순위: 은행 문자 "입금 3,200,000" / "출금 12,000" 처럼 '원'이 없는 형식
    const mt2 = text.match(/(입금|출금|이체|송금|결제|승인)\s*([\d]{1,3}(?:,\d{3})+|\d{3,})(?!\s*[\d*\-])/);
    if (mt2) return toNum(mt2[2]);
    return 0;
  }

  /* ---------- 라벨(key: value) 추출 ---------- */
  function labeled(lines) {
    const out = {};
    for (const raw of lines) {
      const line = raw.replace(BULLET, '').trim();
      const mt = line.match(/^([가-힣A-Za-z ]{1,12}?)\s*[:：]\s*(.+)$/) || line.match(/^([가-힣]{2,8})\s+(.+)$/);
      if (!mt) continue;
      const key = mt[1].replace(/\s+/g, ' ').trim();
      const val = mt[2].trim();
      if (!out.amount && LABELS.amount.test(key) && !/누적|잔액|한도/.test(key)) { const n = findAmount(val) || toNum(val); if (n) out.amount = n; }
      else if (!out.merchant && LABELS.merchant.test(key)) out.merchant = val;
      else if (!out.date && LABELS.date.test(key)) out.dateText = val;
    }
    return out;
  }

  /* ---------- 가맹점 휴리스틱 ---------- */
  function guessMerchant(text) {
    const STRIP = [
      /\[Web발신\]/gi, /\[[^\]]{1,15}\]/g, /\([^)]{0,12}\)/g,
      /(누적|잔액|잔고|한도|가용)\s*(금액)?\s*[:：]?\s*-?[\d,]+\s*원?/g,
      /-?[\d,]+\s*원/g,
      /(20\d{2}\s*[.\-/년]\s*)?\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?(\s*\([월화수목금토일]\))?/g,
      /(오전|오후)?\s*\d{1,2}\s*:\s*\d{2}(:\d{2})?/g,
      /[가-힣]\*+[가-힣]*\s*님?/g, /[가-힣]{2,4}\s*님/g,
      /[\w가-힣]*(카드|은행|뱅크|증권|페이먼트)[\w가-힣]*/g,
      /\b(KB|NH|IBK|SC|BC|BNK|DGB|KEB|SH)\w*/g,
      /[\d*\-]{5,}/g, /\b\d{3,4}\b/g,
      /(일시불|할부|\d+\s*개월|해외|국내|체크|신용|승인|결제|사용|입금|출금|이체|송금|취소|안내|알림|완료|되었습니다|하였습니다|입니다|고객님|누적|잔액|원)/g,
      /[■□▶▷►•·*※◆◇○●:：,|/]+/g,
    ];
    // 줄 단위로 걸러서 남는 것 중 가장 그럴듯한(긴) 줄을 고른다
    const cands = text.split('\n').map(line => {
      let s = line;
      for (const re of STRIP) s = s.replace(re, ' ');
      return s.replace(/\s+/g, ' ').trim();
    }).filter(s => s && s.length >= 2);
    if (!cands.length) return '';
    // 여러 줄이면 마지막 쪽(가맹점이 대체로 뒤에 옴) 중 가장 긴 것
    return cands.sort((a, b) => b.length - a.length)[0].slice(0, 30);
  }

  /* ---------- 메시지 분리 ---------- */
  const KAKAO_EXPORT_HEAD = /^(20\d{2}[.년]\s*\d{1,2}[.월]\s*\d{1,2}일?\.?\s*(오전|오후)?\s*\d{1,2}:\d{2},?\s*.{1,30}?\s*:\s*)/; // 카톡 대화 내보내기 줄머리
  const KAKAO_COPY_HEAD = /^\[[^\]]{1,20}\]\s*\[(오전|오후)\s*\d{1,2}:\d{2}\]\s*/;                       // 카톡 여러 메시지 복사 줄머리
  const DATE_DIVIDER = /^-{3,}.*-{3,}$|^20\d{2}년\s*\d{1,2}월\s*\d{1,2}일\s*[월화수목금토일]요일$/;
  const HEADER_LIKE = /^\[[^\]]{1,15}\]|^\S*(카드|은행|뱅크|페이)\S*\s*(승인|결제|사용|입금|출금|취소|이체|안내)|^\[Web발신\]/;

  function splitMessages(input) {
    const lines = String(input).replace(/\r/g, '').split('\n');
    const chunks = [];
    let cur = [];
    const flush = () => { const t = cur.join('\n').trim(); if (t) chunks.push(t); cur = []; };
    for (let line of lines) {
      const trimmed = line.trim();
      if (!trimmed || DATE_DIVIDER.test(trimmed) || /^\[Web발신\]$/i.test(trimmed)) { flush(); continue; }
      let isHead = false;
      const kx = trimmed.match(KAKAO_EXPORT_HEAD) || trimmed.match(KAKAO_COPY_HEAD);
      if (kx) { isHead = true; line = trimmed.slice(kx[0].length); }
      else if (HEADER_LIKE.test(trimmed) && findAmount(cur.join('\n')) > 0) isHead = true;
      if (isHead) flush();
      cur.push(line);
    }
    flush();
    return chunks;
  }

  /* ---------- 한 건 해석 ---------- */
  function parseOne(text, now) {
    const lines = text.split('\n');
    const lab = labeled(lines);
    const amount = lab.amount || findAmount(text);
    if (!amount) return null;

    let type;
    const isCancel = CANCEL_WORDS.test(text) && !/취소\s*가능|취소\s*시/.test(text);
    if (isCancel) type = 'cancel';
    else if (INCOME_WORDS.test(text) && !(/출금/.test(text) && !/입금/.test(text))) type = 'income';
    else if (EXPENSE_WORDS.test(text) || /원/.test(text)) type = 'expense';
    else return null;

    const date = parseDate(lab.dateText || text, now) || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const merchant = (lab.merchant || guessMerchant(text) || '').trim();
    const catType = type === 'income' ? 'income' : 'expense';
    return { type, amount, date, merchant, category: guessCategory(catType, merchant, text), raw: text };
  }

  function parseNotifications(input, now = new Date()) {
    // 자동화 앱이 줄바꿈을 없애거나 '\n' 글자로 보내는 경우 복원: 글머리표(■ 등) 앞에서 줄을 나눈다
    input = String(input).replace(/\\n/g, '\n').replace(/[ \t]+(?=[■□▶▷►•※◆◇●]\s*[가-힣])/g, '\n');
    const results = [];
    let skipped = 0;
    for (const chunk of splitMessages(input)) {
      const r = parseOne(chunk, now);
      if (r) results.push(r); else skipped++;
    }
    return { results, skipped };
  }


  /* ===================== 고정 항목 목록 파서 =====================
   * 크롬 확장/AI가 준 마크다운 표, CSV/TSV, "넷플릭스 17,000원 매월 5일" 같은 줄 모두 처리.
   * [고정수입] / [고정지출] / [저축/이동] / [카드대금] 섹션 제목이 있으면 그것으로 종류를 정한다.
   */
  function parseKoreanAmount(str) {
    const s = String(str).replace(/\s+/g, '');
    let m;
    if ((m = s.match(/(\d+(?:\.\d+)?)억(?:(\d[\d,]*)만)?/))) return Math.round(parseFloat(m[1]) * 1e8 + (m[2] ? toNum(m[2]) * 1e4 : 0));
    if ((m = s.match(/(\d[\d,]*(?:\.\d+)?)만(?:(\d)천)?(?:([\d,]+)원)?/))) {
      return Math.round(parseFloat(m[1].replace(/,/g, '')) * 1e4 + (m[2] ? +m[2] * 1000 : 0) + (m[3] ? toNum(m[3]) : 0));
    }
    if ((m = s.match(/(\d{1,3}(?:,\d{3})+|\d+)원/))) return toNum(m[1]);
    if ((m = s.match(/^[^\d]*(\d{1,3}(?:,\d{3})+|\d{3,})(?!\d)/))) return toNum(m[1]);
    return 0;
  }
  function parseDay(str) {
    if (/말일/.test(str)) return 31;
    const m = String(str).match(/(\d{1,2})\s*일/) || String(str).match(/^\s*(\d{1,2})\s*$/);
    const d = m ? +m[1] : 0;
    return d >= 1 && d <= 31 ? d : '';
  }

  // 순서 중요: 위에서부터 먼저 맞는 것으로 섹션 종류 결정
  const SECTION = [
    [/뺀|제외|애매|해지|절약|검토|참고|요약|설명|주의/, 'skip'],
    [/할부/, 'installment'],
    [/고정\s*수입|수입|입금|급여/, 'income'],
    [/저축|이동|적금|투자/, 'saving'],
    [/카드\s*대금/, 'card'],
    [/고정\s*지출|지출|출금|자동\s*이체|정기\s*결제|월\s*반복/, 'expense'],
  ];
  const SKIP_ROW = /^(항목명?|이름|가맹점|입금자|구분|합계|총\s*합|소계|차액|월\s*고정|승인일|회차)/;
  const PROSE = /합계|총액|니다|어요|해요|세요|었|았|겠|\?|예상/;
  const isHeading = line => /^(#{1,6}\s|\[[^\]]+\]\s*$|\*\*[^*]+\*\*\s*:?\s*$)/.test(line) || (line.length <= 20 && !/\d{3}|\d+\s*만/.test(line) && !line.includes('|'));

  function parseFixedList(input, expenseCats, incomeCats, now = new Date()) {
    const lines = String(input).replace(/\r/g, '').split('\n');
    let section = null, sectionDay = '';
    const items = [];
    for (const raw of lines) {
      let line = raw.trim();
      if (!line) continue;
      // 섹션 안 설명문에서 공통 결제일 읽기 (예: "결제일은 매월 26일입니다") — 짧은 문장은 제목으로 오인되므로 먼저 검사
      const sd = line.match(/결제일[은는]?\s*(매월|매달)?\s*(\d{1,2})\s*일/);
      if (sd && !line.startsWith('|')) { sectionDay = +sd[2]; continue; }
      if (isHeading(line)) {
        const title = line.replace(/[\[\]#*:：]/g, '');
        let found = null;
        for (const [re, t] of SECTION) if (re.test(title)) { found = t; break; }
        // 제목은 있는데 아는 섹션이 아니면(계좌 목록, 돈의 경로, 월별 흐름 등) 통째로 건너뛴다.
        // 잔액·이체 합계가 고정지출로 잘못 등록되는 것을 막기 위함. 짧은 일반 문장(20자 이하)은 제목이 아닐 수 있어 # / [ ] 형식만 해당.
        if (found) { section = found; sectionDay = ''; }
        else if (/^(#{1,6}\s|\[)/.test(line)) { section = 'skip'; sectionDay = ''; }
        continue;
      }
      if (section === 'skip') continue;
      if (/^\|?\s*:?-{2,}/.test(line)) continue; // 표 구분선

      let cols = null;
      line = line.replace(/\*{2,}\d{2,}/g, ' ');   // 마스킹된 계좌번호(****1234)는 금액이 아님
      if (line.includes('|')) cols = line.replace(/^\||\|$/g, '').split('|');
      else if (line.includes('\t')) cols = line.split('\t');
      else if (line.split(',').length >= 3 && !PROSE.test(line) && line.split(',').every(c => c.trim().length <= 25)) cols = line.split(',');

      let name, amount, day = '', catText = '', approval = '';
      if (cols) {
        cols = cols.map(c => c.replace(/\*\*/g, '').trim());
        name = cols[0];
        if (!name || SKIP_ROW.test(name)) continue;
        const amtIdx = cols.findIndex((c, i) => i > 0 && /원|만/.test(c) && parseKoreanAmount(c) > 0)
          ?? -1;
        const idx = amtIdx >= 0 ? amtIdx : cols.findIndex((c, i) => i > 0 && /^[\d,]{4,}$/.test(c));
        if (idx < 0) continue;
        amount = parseKoreanAmount(cols[idx]);
        const rest = cols.slice(idx + 1);
        const dayCol = rest.find(c => parseDay(c) !== '' && !/개월|회/.test(c));
        day = dayCol ? parseDay(dayCol) : '';
        catText = rest.filter(c => c !== dayCol).join(' ');
        approval = (cols.slice(1, idx).find(c => /^\d{1,2}[./]\d{1,2}$/.test(c)) || '');
      } else {
        // 자유 형식 한 줄: "넷플릭스 17,000원 매월 5일" — 설명 문장은 제외
        const plain = line.replace(/\*\*/g, '');
        if (plain.length > 45 || PROSE.test(plain)) continue;
        amount = parseKoreanAmount(plain);
        if (!amount) continue;
        name = plain.split(/\s*[-–:：]?\s*\d/)[0].replace(/^[-*•·\d.)\s]+/, '').trim();
        if (!name || SKIP_ROW.test(name)) continue;
        const dm = plain.match(/(매월|매달)?\s*(\d{1,2})\s*일|말일/);
        day = dm ? parseDay(dm[0]) : '';
        catText = plain;
      }
      const all = cols ? cols.join(' ') : line;
      let kind = section || 'expense';
      if (!section && /급여|월급|상여|이자|배당|입금/.test(all)) kind = 'income';
      if (/카드\s*대금/.test(name)) kind = 'card';
      else if (kind === 'card' && !/카드/.test(name)) kind = 'expense';
      const type = kind === 'income' ? 'income' : 'expense';

      // 할부: 남은 회차/종료일 → until(마지막 납부 월)
      let until = '';
      if (kind === 'installment') {
        const end = all.match(/~\s*(20\d{2})[.\-/](\d{1,2})/);
        const remainCells = (cols || [all]).map(c => c.match(/(\d+)\s*회/)).filter(Boolean);
        if (end) until = `${end[1]}-${pad(+end[2])}`;
        else if (remainCells.length) {
          const n = +remainCells[remainCells.length - 1][1];
          const d = new Date(now.getFullYear(), now.getMonth() + n - 1, 1);
          until = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
        }
        if (!day) day = sectionDay;
      }

      const cats = type === 'income' ? incomeCats : expenseCats;
      let category = cats.find(c => c !== '기타' && catText.includes(c)) || cats.find(c => c !== '기타' && all.includes(c));
      if (!category) category = guessCategory(type, name, all);
      if (kind === 'saving') category = '기타';
      name = name.replace(/\s*\([^)]*(\d{3}|자동이체|메모|추정|확인|→|은행|뱅크|계좌|주식회사)[^)]*\)?/g, '').replace(/\s*\d[\d-]{6,}\d/g, '').replace(/\s*\((추정|확인\s*필요)\)/g, '').replace(/\s{2,}/g, ' ').replace(/\s*[\d,]+\s*원\s*건?/g, '').trim() || name;
      const label = kind === 'installment' ? `${name} 할부${approval ? ` (${approval})` : ''}` : name;
      items.push({ kind, type, name: label.slice(0, 30), amount, day, category, until, guess: /추정|확실하지|아마/.test(all) });
    }
    return items;
  }

  const api = { parseNotifications, splitMessages, parseOne, guessCategory, parseFixedList, parseKoreanAmount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SmsParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
