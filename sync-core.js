'use strict';
/*
 * 동기화 핵심 로직 (Firebase와 무관한 순수 함수 — node로 테스트 가능).
 *
 * 원칙: 기기(localStorage)가 원본, 클라우드는 여러 기기 간 합치기용.
 * - 레코드(tx/fixed/goals)마다 u(마지막 수정 시각)를 두고, 같은 id는 u가 큰 쪽이 이긴다.
 * - 삭제는 tomb[`${종류}:${id}`] = 삭제 시각 으로 남겨 다른 기기에도 전파한다.
 * - settings, merchantCats는 통째로 마지막 수정이 이긴다(settingsU, mcU).
 * - 클라우드에는 'meta' 문서 1개 + 월별 거래 문서 'tx-YYYY-MM' 로 나눠 저장(문서 1MB 제한 대비).
 */
(function (root) {
  const TYPES = ['tx', 'fixed', 'goals', 'bills', 'assets', 'funds', 'pending'];
  const noU = (k, v) => (k === 'u' ? undefined : v);

  // 저장 직전 호출: 이전 스냅샷과 비교해 바뀐 레코드에 u를 찍고, 사라진 레코드는 tomb에 기록
  function stamp(state, snap, now = Date.now()) {
    state.tomb = state.tomb || {};
    const next = {};
    for (const t of TYPES) {
      for (const r of state[t] || []) {
        const key = `${t}:${r.id}`;
        const json = JSON.stringify(r, noU);
        if (snap.rec[key] !== json) r.u = now;
        next[key] = json;
        delete state.tomb[key]; // 되살린(다시 추가한) 경우
      }
    }
    for (const key of Object.keys(snap.rec)) if (!(key in next)) state.tomb[key] = now;
    const sj = JSON.stringify(state.settings || {});
    if (snap.settings !== undefined && sj !== snap.settings) state.settingsU = now;
    const mj = JSON.stringify(state.merchantCats || {});
    if (snap.mc !== undefined && mj !== snap.mc) state.mcU = now;
    return { rec: next, settings: sj, mc: mj };
  }

  function snapshot(state) {
    const rec = {};
    for (const t of TYPES) for (const r of state[t] || []) rec[`${t}:${r.id}`] = JSON.stringify(r, noU);
    return { rec, settings: JSON.stringify(state.settings || {}), mc: JSON.stringify(state.merchantCats || {}) };
  }

  // 두 상태 합치기 (교환법칙 성립 — 어느 기기에서 합쳐도 결과 동일)
  function merge(a, b) {
    const out = { ...a };
    const tomb = { ...(a.tomb || {}) };
    for (const [k, v] of Object.entries(b.tomb || {})) tomb[k] = Math.max(tomb[k] || 0, v);
    for (const t of TYPES) {
      const m = new Map();
      for (const r of [...(a[t] || []), ...(b[t] || [])]) {
        const cur = m.get(r.id);
        if (!cur || (r.u || 0) > (cur.u || 0) || ((r.u || 0) === (cur.u || 0) && JSON.stringify(r) > JSON.stringify(cur))) m.set(r.id, r);
      }
      out[t] = [...m.values()].filter(r => !(tomb[`${t}:${r.id}`] >= (r.u || 0))).map(r => ({ ...r })); // 입력과 객체 공유 금지
    }
    const pick = (field, uField) => {
      const au = a[uField] || 0, bu = b[uField] || 0;
      return bu > au ? [b[field], bu] : [a[field], au];
    };
    [out.settings, out.settingsU] = pick('settings', 'settingsU');
    [out.merchantCats, out.mcU] = pick('merchantCats', 'mcU');
    out.tomb = tomb;
    return out;
  }

  // 상태 → 클라우드 문서들 { key: data }
  function toChunks(state) {
    const chunks = {
      meta: {
        fixed: state.fixed || [], goals: state.goals || [], bills: state.bills || [], assets: state.assets || [], funds: state.funds || [], pending: state.pending || [], tomb: state.tomb || {},
        settings: state.settings || {}, settingsU: state.settingsU || 0,
        merchantCats: state.merchantCats || {}, mcU: state.mcU || 0,
      },
    };
    for (const r of state.tx || []) {
      const key = `tx-${String(r.date || '').slice(0, 7) || 'none'}`;
      (chunks[key] = chunks[key] || { tx: [] }).tx.push(r);
    }
    for (const c of Object.values(chunks)) if (c.tx) c.tx.sort((x, y) => (x.id < y.id ? -1 : 1));
    return chunks;
  }

  // 클라우드 문서들 → 상태
  function fromChunks(chunks) {
    const meta = chunks.meta || {};
    const tx = [];
    for (const [k, v] of Object.entries(chunks)) if (k.startsWith('tx-')) tx.push(...(v.tx || []));
    return {
      tx, fixed: meta.fixed || [], goals: meta.goals || [], bills: meta.bills || [], assets: meta.assets || [], funds: meta.funds || [], pending: meta.pending || [], tomb: meta.tomb || {},
      settings: meta.settings || {}, settingsU: meta.settingsU || 0,
      merchantCats: meta.merchantCats || {}, mcU: meta.mcU || 0,
    };
  }

  // 바뀐 문서만 쓰기 위한 간단한 해시
  function hash(obj) {
    const s = JSON.stringify(obj);
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + ':' + s.length;
  }

  const api = { stamp, snapshot, merge, toChunks, fromChunks, hash, TYPES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SyncCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
