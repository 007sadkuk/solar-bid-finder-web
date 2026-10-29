/* 땅의 가치 — 검색 기록·상담 신청 받기 (Google Apps Script, 2026-10-29 배포본)
   붙여넣기 → 저장 → [배포] → [배포 관리] → 연필 → 버전 '새 버전' → 배포.
   웹 앱 주소를 브라우저로 열면 작동 확인 + 기록 시트 주소 표시. */
var NOTIFY_EMAIL = "kukdas700@gmail.com";
var DATA_KEY = "여기에_공공데이터포털_인증키";   // 생태자연도 조회용(Decoding 키). 홈페이지에 노출되지 않음
function book_() {
  var ss = null; try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (ss) return ss;
  var pr = PropertiesService.getScriptProperties(), id = pr.getProperty("SHEET_ID");
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  ss = SpreadsheetApp.create("땅의 가치 기록"); pr.setProperty("SHEET_ID", ss.getId()); return ss;
}
function add_(ss, name, head, row) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(head);
  sh.appendRow(row);
}
function eco_(bbox) {  // 생태자연도(국립생태원) 조회 중계. bbox: EPSG:5186 minx,miny,maxx,maxy
  if (!/^[\d.]+,[\d.]+,[\d.]+,[\d.]+$/.test(bbox)) return { error: "bbox" };
  var c = CacheService.getScriptCache(), hit = c.get("eco" + bbox);
  if (hit) return JSON.parse(hit);
  var u = "https://apis.data.go.kr/B553084/ecoapi/EcologyzmpService/wfs/getEcologyzmpWFS?ServiceKey=" + encodeURIComponent(DATA_KEY) +
    "&typeName=tbl_opn_eczm&srsName=EPSG:5186&outputFormat=application/json&bbox=" + bbox;
  var r = UrlFetchApp.fetch(u, { muteHttpExceptions: true }), j;
  try { j = JSON.parse(r.getContentText()); } catch (x) { return { error: "응답 " + r.getResponseCode() }; }
  var out = { f: (j.features || []).map(function (f) {
    var g = f.geometry || {}, cs = g.type === "Polygon" ? [g.coordinates] : (g.coordinates || []);
    return [String(f.properties.eczm_grad), cs.map(function (pl) { return pl[0].map(function (p) { return [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]; }); })];
  }) };
  try { c.put("eco" + bbox, JSON.stringify(out), 21600); } catch (x) {}
  return out;
}
function doGet(e) {
  if (e && e.parameter && e.parameter.action === "eco")
    return ContentService.createTextOutput(JSON.stringify(eco_(e.parameter.bbox || ""))).setMimeType(ContentService.MimeType.JSON);
  var ss = book_();
  add_(ss, "검색", ["시각","입력 주소","찾은 주소","PNU","찾음","용도지역","면적㎡","가능 판정","오류"], [new Date(), "(접속 확인)"]);
  return ContentService.createTextOutput("정상 작동 중입니다. 기록 시트: " + ss.getUrl());
}
function doPost(e) {
  var d = {}; try { d = JSON.parse(e.postData.contents); } catch (x) { return ContentService.createTextOutput("bad"); }
  var ss = book_(), s = d.summary || {};
  if (d.type === "contact") {
    add_(ss, "상담", ["받은 시각","이름","연락처","관계","관심 개발","문의 내용","땅 주소","PNU","용도지역","면적㎡","가능 판정"], [new Date(), d.name, "'" + (d.phone || ""), d.relation, d.interest, d.memo, d.addr, "'" + (d.pnu || ""), s.zone, s.area, s.best]);
    if (NOTIFY_EMAIL) MailApp.sendEmail(NOTIFY_EMAIL, "[땅의 가치] 상담 신청: " + (d.addr || ""), "이름: " + d.name + "\n연락처: " + d.phone + "\n땅: " + d.addr + "\n문의: " + (d.memo || "-"));
  } else if (d.type === "kakao_click") {
    add_(ss, "카톡 상담 클릭", ["시각","땅 주소","PNU","용도지역","면적㎡","가능 판정"], [new Date(), d.addr, "'" + (d.pnu || ""), s.zone, s.area, s.best]);
  } else {
    add_(ss, "검색", ["시각","입력 주소","찾은 주소","PNU","찾음","용도지역","면적㎡","가능 판정","오류"], [new Date(), d.query, d.addr, "'" + (d.pnu || ""), d.found, d.zone, d.area, d.best, d.error || ""]);
  }
  return ContentService.createTextOutput("ok");
}
