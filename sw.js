// 오프라인 지원 + 빠른 업데이트.
// 네트워크 우선: 온라인이면 항상 최신 파일을 받고 캐시를 갱신, 오프라인일 때만 캐시 사용.
// (앱을 고치면서 폰에서 바로 확인하기 위해 캐시 우선 → 네트워크 우선으로 변경)
const CACHE = 'eok-v31'; // 배포 때 deploy.sh가 버전으로 바꿔 씀 (바뀌면 폰이 새 버전 받음)
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'version.js', 'parser.js', 'sync-core.js', 'ai.js', 'sync.js', 'firebase-config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(e.request, { cache: 'no-cache' });
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      return (await cache.match(e.request, { ignoreSearch: true })) || (await cache.match('./'));
    }
  })());
});
