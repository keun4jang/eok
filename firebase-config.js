// Firebase 웹 앱 설정 (프로젝트 eok-app-e1d57). 이 값들은 비밀이 아니다(웹 앱에 원래 공개됨).
// 데이터 보호는 Firestore 보안 규칙 + 승인된 도메인으로 한다 (docs/FIREBASE_SETUP.md).
// null로 바꾸면 로그인 기능이 꺼진 채(기기 저장만)로 동작한다.
export default {
  apiKey: 'AIzaSyABKYiVI_bdoP2hY77vdGu09FDUl-AwloA',
  authDomain: 'eok-app-e1d57.firebaseapp.com',
  projectId: 'eok-app-e1d57',
  storageBucket: 'eok-app-e1d57.firebasestorage.app',
  messagingSenderId: '693601275486',
  appId: '1:693601275486:web:c25019a5c58a64d4f2aecf',
  // App Check(reCAPTCHA v3) 사이트 키 — 공개 값. 비밀 키는 Firebase 콘솔에만 있음.
  appCheckSiteKey: '6LeqsiEuAAAAAMbqOIkQ50JTnzTgreo7ikasrc-K',
};
