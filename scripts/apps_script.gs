var NOTIFY_EMAIL = "kukdas700@gmail.com";
var DATA_KEY = "여기에_인증키";
var HS = ["시각","입력 주소","찾은 주소","PNU","찾음","용도지역","면적㎡","가능 판정","오류"];
function book_() {
  var ss = null; try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (ss) return ss;
  var pr = PropertiesService.getScriptProperties(), id = pr.getProperty("SHEET_ID");
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  ss = SpreadsheetApp.create("땅의 가치 기록"); pr.setProperty("SHEET_ID", ss.getId()); return ss;
}
function add_(ss, name, head, row) { var sh = ss.getSheetByName(name) || ss.insertSheet(name); if (sh.getLastRow() === 0) sh.appendRow(head); sh.appendRow(row); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function eco_(bb) {
  if (!/^[\d.]+,[\d.]+,[\d.]+,[\d.]+$/.test(bb)) return { error: "bbox" };
  var r = UrlFetchApp.fetch("https://apis.data.go.kr/B553084/ecoapi/EcologyzmpService/wfs/getEcologyzmpWFS?ServiceKey=" + encodeURIComponent(DATA_KEY) + "&typeName=tbl_opn_eczm&srsName=EPSG:5186&outputFormat=application/json&bbox=" + bb, { muteHttpExceptions: true }), j;
  try { j = JSON.parse(r.getContentText()); } catch (x) { return { error: "응답 " + r.getResponseCode() + " " + r.getContentText().slice(0, 100) }; }
  return { f: (j.features || []).map(function (f) { var g = f.geometry || {}, cs = g.type === "Polygon" ? [g.coordinates] : (g.coordinates || []);
    return [String(f.properties.eczm_grad), cs.map(function (pl) { return pl[0].map(function (p) { return [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]; }); })]; }) };
}
function doGet(e) {
  if (e && e.parameter && e.parameter.action === "eco") return json_(eco_(e.parameter.bbox || ""));
  var ss = book_(); add_(ss, "검색", HS, [new Date(), "(접속 확인)"]);
  return ContentService.createTextOutput("정상 작동 중입니다. 기록 시트: " + ss.getUrl());
}
function doPost(e) {
  var d = {}; try { d = JSON.parse(e.postData.contents); } catch (x) { return ContentService.createTextOutput("bad"); }
  var ss = book_(), s = d.summary || {};
  if (d.type === "contact") {
    add_(ss, "상담", ["받은 시각","이름","연락처","관계","관심 개발","문의 내용","땅 주소","PNU","용도지역","면적㎡","가능 판정"], [new Date(), d.name, "'" + (d.phone || ""), d.relation, d.interest, d.memo, d.addr, "'" + (d.pnu || ""), s.zone, s.area, s.best]);
    if (NOTIFY_EMAIL) MailApp.sendEmail(NOTIFY_EMAIL, "[땅의 가치] 상담 신청: " + (d.addr || ""), "이름: " + d.name + "\n연락처: " + d.phone + "\n땅: " + d.addr + "\n문의: " + (d.memo || "-"));
  } else if (d.type === "kakao_click") add_(ss, "카톡 상담 클릭", ["시각","땅 주소","PNU","용도지역","면적㎡","가능 판정"], [new Date(), d.addr, "'" + (d.pnu || ""), s.zone, s.area, s.best]);
  else add_(ss, "검색", HS, [new Date(), d.query, d.addr, "'" + (d.pnu || ""), d.found, d.zone, d.area, d.best, d.error || ""]);
  return ContentService.createTextOutput("ok");
}
