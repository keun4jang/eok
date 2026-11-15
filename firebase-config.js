// Firebase 웹 앱 설정. Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹)에서 복사해 넣는다.
// 이 값들은 비밀이 아니다(웹 앱에 원래 공개됨). 데이터 보호는 Firestore 보안 규칙 + 승인된 도메인으로 한다.
// null이면 로그인 기능이 꺼진 채(기기 저장만)로 동작한다.
export default null;
/* 예:
export default {
  apiKey: '...',
  authDomain: '프로젝트ID.firebaseapp.com',
  projectId: '프로젝트ID',
  appId: '...',
};
*/
