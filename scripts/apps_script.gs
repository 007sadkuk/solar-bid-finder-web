/* 땅의 가치 — 검색 기록·상담 신청 받기 (Google Apps Script)
   1) 구글 스프레드시트를 새로 만들고 [확장 프로그램] → [Apps Script]를 엽니다.
   2) 이 코드를 통째로 붙여넣고 NOTIFY_EMAIL을 상담 알림 받을 메일로 바꿉니다.
   3) [배포] → [새 배포] → 유형 '웹 앱' / 실행 사용자 '나' / 액세스 '모든 사용자' → 배포.
   4) 나오는 '웹 앱 URL'을 docs/site-config.js 의 endpoint 에 넣습니다. */
var NOTIFY_EMAIL = "kukdas700@gmail.com";   // 상담 신청 알림 메일(비우면 알림 없음)

/* 기록할 스프레드시트: 시트에서 연 스크립트면 그 시트, 따로 만든 스크립트면 처음 한 번 새 시트를 만들어 계속 사용 */
function book_() {
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (err) {}
  if (ss) return ss;
  var pr = PropertiesService.getScriptProperties(), id = pr.getProperty("SHEET_ID");
  if (id) { try { return SpreadsheetApp.openById(id); } catch (err) {} }
  ss = SpreadsheetApp.create("땅의 가치 기록");
  pr.setProperty("SHEET_ID", ss.getId());
  return ss;
}

/* 브라우저로 웹 앱 주소를 열면: 작동 확인 + '검색' 시트에 확인 줄 1개 + 시트 주소 표시 */
function doGet(e) {
  var ss = book_();
  log_(ss, { type: "search", query: "(접속 확인)", found: "", error: "" });
  return ContentService.createTextOutput("정상 작동 중입니다.\n기록 시트: " + ss.getUrl());
}

function log_(ss, d) {
  var sh2 = ss.getSheetByName("검색") || ss.insertSheet("검색");
  if (sh2.getLastRow() === 0) sh2.appendRow(["시각", "입력 주소", "찾은 주소", "PNU", "찾음", "용도지역", "면적㎡", "가능 판정", "오류"]);
  sh2.appendRow([new Date(), d.query, d.addr, "'" + (d.pnu || ""), d.found, d.zone, d.area, d.best, d.error || ""]);
}

function doPost(e) {
  var d = {};
  try { d = JSON.parse(e.postData.contents); } catch (err) { return ContentService.createTextOutput("bad"); }
  var ss = book_();
  if (d.type === "contact") {
    var sh = ss.getSheetByName("상담") || ss.insertSheet("상담");
    if (sh.getLastRow() === 0) sh.appendRow(["받은 시각", "이름", "연락처", "관계", "관심 개발", "문의 내용", "땅 주소", "PNU", "용도지역", "면적㎡", "가능 판정"]);
    var s = d.summary || {};
    sh.appendRow([new Date(), d.name, "'" + (d.phone || ""), d.relation, d.interest, d.memo, d.addr, "'" + (d.pnu || ""), s.zone, s.area, s.best]);
    if (NOTIFY_EMAIL) MailApp.sendEmail(NOTIFY_EMAIL, "[땅의 가치] 상담 신청: " + (d.addr || ""),
      "이름: " + d.name + "\n연락처: " + d.phone + "\n관계: " + d.relation + "\n관심: " + d.interest + "\n땅: " + d.addr + "\n문의: " + (d.memo || "-"));
  } else if (d.type === "kakao_click") {
    var sh3 = ss.getSheetByName("카톡 상담 클릭") || ss.insertSheet("카톡 상담 클릭");
    if (sh3.getLastRow() === 0) sh3.appendRow(["시각", "땅 주소", "PNU", "용도지역", "면적㎡", "가능 판정"]);
    var k = d.summary || {};
    sh3.appendRow([new Date(), d.addr, "'" + (d.pnu || ""), k.zone, k.area, k.best]);
  } else {
    log_(ss, d);
  }
  return ContentService.createTextOutput("ok");
}
