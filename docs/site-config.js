/* 땅의 가치 설정
   endpoint: 검색 기록을 받을 주소(구글 Apps Script 웹앱 URL). 비우면 기록하지 않음.
   kakao: 카카오톡 채널 주소(예: https://pf.kakao.com/_xxxxx). 비우면 '준비 중'으로 표시.
   form: 네이버폼 등 상담 신청서 주소. */
window.KT_CFG = {
  endpoint: "",
  kakao: "",
  mailto: "",         // 상담 신청을 받을 메일 주소(FormSubmit). 첫 신청 때 오는 활성화 메일에서 Activate 1회
  web3: "",           // (선택) Web3Forms 접근 키
  form: "https://naver.me/xllw2knD",  // 네이버폼 등 상담 신청서 주소(비우면 버튼 숨김)
  company: "금호테크닉스"
};
