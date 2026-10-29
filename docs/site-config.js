/* 땅의 가치 설정
   endpoint: 검색 기록을 받을 주소(구글 Apps Script 웹앱 URL). 비우면 기록하지 않음.
   kakao: 카카오톡 채널 주소(예: https://pf.kakao.com/_xxxxx). 비우면 '준비 중'으로 표시.
   form: 네이버폼 등 상담 신청서 주소. */
window.KT_CFG = {
  endpoint: "",
  kakao: "",
  web3: "1c6559f24-a596-49c1-9f93-f6e7f64b56a3",  // Web3Forms 접근 키(상담 신청을 메일로 받기). endpoint와 함께 써도 됨
  form: "https://naver.me/xllw2knD",  // 네이버폼 등 상담 신청서 주소(비우면 버튼 숨김)
  company: "금호테크닉스"
};
