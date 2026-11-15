// 로그인(Google) + 클라우드 동기화(Firestore). 기기 저장이 원본이고, 이 모듈은 선택 기능이다.
// 오프라인이거나 설정이 없으면 조용히 꺼져 있고, 앱은 그대로 동작한다.
import config from './firebase-config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const UID_KEY = 'eok.syncUid';
const st = { phase: config ? 'loading' : 'noconfig', user: null, last: null, error: '' };
let fb = null, running = false, pending = false, timer = null;

const set = patch => { Object.assign(st, patch); window.EokApp?.refreshAccount(); };
const S = () => window.SyncCore;

async function init() {
  try {
    const [app, auth, fs] = await Promise.all([
      import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js'),
    ]);
    const a = app.initializeApp(config);
    fb = { auth, fs, authInst: auth.getAuth(a), db: fs.getFirestore(a) };
    // App Check(reCAPTCHA v3): AI 호출이 이 앱에서 온 것임을 증명하는 토큰. 사이트 키가 있을 때만.
    if (config.appCheckSiteKey) {
      try {
        const ac = await import(FB + 'firebase-app-check.js');
        const inst = ac.initializeAppCheck(a, { provider: new ac.ReCaptchaV3Provider(config.appCheckSiteKey), isTokenAutoRefreshEnabled: true });
        window.EokSync.appCheckToken = async () => (await ac.getToken(inst, false)).token;
      } catch (e) { console.warn('App Check 초기화 실패', e); }
    }
    await auth.setPersistence(fb.authInst, auth.browserLocalPersistence);
    auth.getRedirectResult(fb.authInst).catch(e => set({ error: msg(e) }));
    auth.onAuthStateChanged(fb.authInst, onUser);
  } catch (e) {
    set({ phase: navigator.onLine ? 'error' : 'offline', error: navigator.onLine ? '⚠ 연결 실패 · 재시도 중' : '' });
    const retry = () => { if (!fb && st.phase !== 'loading') { set({ phase: 'loading', error: '' }); init(); } };
    window.addEventListener('online', retry, { once: true });
    if (navigator.onLine && (init.tries = (init.tries || 0) + 1) <= 3) setTimeout(retry, 15000 * init.tries);
  }
}

async function onUser(user) {
  if (!user) { set({ phase: 'signedout', user: null }); return; }
  const prev = localStorage.getItem(UID_KEY);
  const local = window.EokApp.getState();
  const hasLocal = (local.tx?.length || 0) + (local.fixed?.length || 0) + (local.goals?.length || 0) > 0;
  if (prev && prev !== user.uid && hasLocal &&
      !confirm(`${user.email}\n이 기기 데이터를 합칠까요?`)) {
    await fb.auth.signOut(fb.authInst); return;
  }
  localStorage.setItem(UID_KEY, user.uid);
  set({ phase: 'ready', user: { email: user.email, name: user.displayName }, error: '' });
  syncNow();
}

async function syncNow() {
  if (!fb || !st.user || !fb.authInst.currentUser) return;
  if (running) { pending = true; return; }
  running = true; set({ phase: 'syncing' });
  try {
    const { collection, getDocs, doc, writeBatch } = fb.fs;
    const uid = fb.authInst.currentUser.uid;
    const col = collection(fb.db, 'users', uid, 'chunks');
    const remoteChunks = {};
    (await getDocs(col)).forEach(d => { remoteChunks[d.id] = d.data(); });

    const local = window.EokApp.getState();
    const merged = S().merge(local, S().fromChunks(remoteChunks));
    const mergedChunks = S().toChunks(merged);
    if (S().hash(mergedChunks) !== S().hash(S().toChunks(local))) window.EokApp.adopt(merged);

    const batch = writeBatch(fb.db);
    let writes = 0;
    for (const [k, v] of Object.entries(mergedChunks)) {
      if (!remoteChunks[k] || S().hash(v) !== S().hash(remoteChunks[k])) { batch.set(doc(col, k), v); writes++; }
    }
    for (const k of Object.keys(remoteChunks)) if (!(k in mergedChunks)) { batch.delete(doc(col, k)); writes++; }
    if (writes) await batch.commit();

    // 자동 수집함: 폰 자동화 앱(MacroDroid 등)이 넣어둔 결제 알림 → 앱에 등록 후 삭제
    const inbox = collection(fb.db, 'users', uid, 'inbox');
    const got = [];
    (await getDocs(inbox)).forEach(d => got.push({ id: d.id, text: String(d.data().text || '') }));
    if (got.length) {
      window.EokApp.ingest(got.map(g => g.text));
      const del = writeBatch(fb.db);
      got.forEach(g => del.delete(doc(inbox, g.id)));
      await del.commit();
    }
    set({ phase: 'ready', last: Date.now(), error: '' });
  } catch (e) {
    set({ phase: 'ready', error: msg(e) });
  } finally {
    running = false;
    if (pending) { pending = false; schedule(500); }
  }
}

function schedule(ms = 2000) { clearTimeout(timer); timer = setTimeout(syncNow, ms); }

async function login() {
  if (!fb) return;
  const p = new fb.auth.GoogleAuthProvider();
  try { await fb.auth.signInWithPopup(fb.authInst, p); }
  catch (e) {
    if (/popup-blocked|operation-not-supported|popup-closed-by-user|cancelled-popup/.test(e.code || '') && !/closed-by-user|cancelled/.test(e.code || '')) {
      await fb.auth.signInWithRedirect(fb.authInst, p);
    } else if (!/closed-by-user|cancelled-popup/.test(e.code || '')) set({ error: msg(e) });
  }
}
async function logout() {
  if (!fb) return;
  if (!confirm('로그아웃? (기기 데이터는 유지)')) return;
  await fb.auth.signOut(fb.authInst);
}

function msg(e) {
  const c = e?.code || '';
  if (c.includes('unauthorized-domain')) return '⚠ 승인되지 않은 도메인';
  if (c.includes('permission-denied')) return '⚠ 권한 오류';
  if (c.includes('network') || c.includes('unavailable')) return '⚠ 네트워크 오류';
  return e?.message || String(e);
}

// 자동 수집 열쇠: 이 값을 아는 요청만 수집함에 쓸 수 있다(Firestore 규칙에서 검사)
async function dropInfo(create = false) {
  if (!fb?.authInst.currentUser) return null;
  const { doc, getDoc, setDoc } = fb.fs;
  const uid = fb.authInst.currentUser.uid;
  const ref = doc(fb.db, 'users', uid, 'private', 'drop');
  let key = (await getDoc(ref)).data()?.key;
  if (!key && create) {
    const a = new Uint8Array(18); crypto.getRandomValues(a);
    key = Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
    await setDoc(ref, { key });
  }
  if (!key) return null;
  return {
    url: `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents/users/${uid}/inbox?key=${config.apiKey}`,
    key,
  };
}

window.EokSync = { status: () => st, login, logout, syncNow, schedule, dropInfo };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(300); });
window.addEventListener('online', () => schedule(300));
if (config) init(); else window.EokApp?.refreshAccount();
