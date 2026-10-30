var NOTIFY_EMAIL = "kukdas700@gmail.com";
var DATA_KEY = "여기에_인증키";
var SITE = "https://007sadkuk.github.io/solar-bid-finder-web/";
var HS = ["시각","입력 주소","찾은 주소","PNU","찾음","용도지역","면적㎡","가능 판정","오류"];
var HW = ["등록 시각","이메일","연락처","땅 주소","PNU","리","지목","마지막 확인"];
function book_() {
  var ss = null; try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (ss) return ss;
  var pr = PropertiesService.getScriptProperties(), id = pr.getProperty("SHEET_ID");
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  ss = SpreadsheetApp.create("땅의 가치 기록"); pr.setProperty("SHEET_ID", ss.getId()); return ss;
}
function sh_(ss, name, head) { var sh = ss.getSheetByName(name) || ss.insertSheet(name); if (sh.getLastRow() === 0) sh.appendRow(head); return sh; }
function add_(ss, name, head, row) { sh_(ss, name, head).appendRow(row); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function hex_(t) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, t, Utilities.Charset.UTF_8).map(function (b) { return ("0" + (b & 255).toString(16)).slice(-2); }).join(""); }
function eco_(bb) {
  if (!/^[\d.]+,[\d.]+,[\d.]+,[\d.]+$/.test(bb)) return { error: "bbox" };
  var r = UrlFetchApp.fetch("https://apis.data.go.kr/B553084/ecoapi/EcologyzmpService/wfs/getEcologyzmpWFS?ServiceKey=" + encodeURIComponent(decodeURIComponent(DATA_KEY.trim())) + "&typeName=tbl_opn_eczm&srsName=EPSG:5186&outputFormat=application/json&bbox=" + bb, { muteHttpExceptions: true }), j;
  try { j = JSON.parse(r.getContentText()); } catch (x) { return { error: "응답 " + r.getResponseCode() + " " + r.getContentText().slice(0, 300) }; }
  return { f: (j.features || []).map(function (f) { var g = f.geometry || {}, cs = g.type === "Polygon" ? [g.coordinates] : (g.coordinates || []);
    return [String(f.properties.eczm_grad), cs.map(function (pl) { return pl[0].map(function (p) { return [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]; }); })]; }) };
}
function admin_(pw) {  // 관리자 화면: 비밀번호 확인(10회 틀리면 1시간 잠금) 후 기록 반환
  var c = CacheService.getScriptCache(), n = +(c.get("fail") || 0);
  if (n >= 10) return { error: "잠시 후 다시 시도하세요" };
  if (hex_(pw || "") !== "6a2dbdf30a1306f82541c097b4b7b7691c91b9a895e89a621937a2b34a64abc6") { c.put("fail", String(n + 1), 3600); return { error: "비밀번호가 맞지 않습니다" }; }
  var ss = book_(), out = {};
  ["검색", "상담", "관심 필지", "카톡 상담 클릭"].forEach(function (k) { var s = ss.getSheetByName(k); if (!s || s.getLastRow() < 2) { out[k] = []; return; }
    var v = s.getDataRange().getDisplayValues(); out[k] = [v[0]].concat(v.slice(Math.max(1, v.length - 500))); });
  out.sheet = ss.getUrl(); return out;
}
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === "eco") return json_(eco_(p.bbox || ""));
  if (p.action === "admin") return json_(admin_(p.pw));
  var ss = book_(); add_(ss, "검색", HS, [new Date(), "(접속 확인)"]);
  return ContentService.createTextOutput("정상 작동 중입니다. 기록 시트: " + ss.getUrl());
}
function doPost(e) {
  var d = {}; try { d = JSON.parse(e.postData.contents); } catch (x) { return ContentService.createTextOutput("bad"); }
  var ss = book_(), s = d.summary || {};
  if (d.type === "contact") {
    add_(ss, "상담", ["받은 시각","이름","연락처","관계","관심 개발","문의 내용","땅 주소","PNU","용도지역","면적㎡","가능 판정"], [new Date(), d.name, "'" + (d.phone || ""), d.relation, d.interest, d.memo, d.addr, "'" + (d.pnu || ""), s.zone, s.area, s.best]);
    if (NOTIFY_EMAIL) MailApp.sendEmail(NOTIFY_EMAIL, "[땅의 가치] 상담 신청: " + (d.addr || ""), "이름: " + d.name + "\n연락처: " + d.phone + "\n땅: " + d.addr + "\n문의: " + (d.memo || "-"));
  } else if (d.type === "watch") {
    add_(ss, "관심 필지", HW, [new Date(), d.email || "", "'" + (d.phone || ""), d.addr, "'" + (d.pnu || ""), d.li || "", d.jimok || "", Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd")]);
    if (NOTIFY_EMAIL) MailApp.sendEmail(NOTIFY_EMAIL, "[땅의 가치] 관심 필지 등록: " + (d.addr || ""), "이메일: " + (d.email || "-") + "\n연락처: " + (d.phone || "-") + "\n땅: " + d.addr);
  } else if (d.type === "kakao_click") add_(ss, "카톡 상담 클릭", ["시각","땅 주소","PNU","용도지역","면적㎡","가능 판정"], [new Date(), d.addr, "'" + (d.pnu || ""), s.zone, s.area, s.best]);
  else add_(ss, "검색", HS, [new Date(), d.query, d.addr, "'" + (d.pnu || ""), d.found, d.zone, d.area, d.best, d.error || ""]);
  return ContentService.createTextOutput("ok");
}
function dailyCheck() {  // 매일: 관심 필지 주변(같은 리)에 새 실거래가 올라오면 메일
  var sh = sh_(book_(), "관심 필지", HW), v = sh.getDataRange().getValues(), cache = {}, today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd");
  for (var i = 1; i < v.length; i++) {
    var email = v[i][1], pnu = String(v[i][4]).replace("'", ""), li = v[i][5], last = String(v[i][7] || "0");
    if (!email || pnu.length < 5 || !li) continue;
    var sgg = pnu.slice(0, 5), t = cache[sgg];
    if (t === undefined) { try { t = JSON.parse(UrlFetchApp.fetch(SITE + "trades/" + sgg + ".json", { muteHttpExceptions: true }).getContentText()); } catch (x) { t = null; } cache[sgg] = t; }
    if (!t || !t.rows) continue;
    var hits = [];
    Object.keys(t.rows).forEach(function (k) { t.rows[k].forEach(function (r) { var u = r[1] || ""; if ((u === li || u.slice(-li.length - 1) === " " + li) && r[0] > last && !/지분/.test(r[7] || "")) hits.push(r); }); });
    if (hits.length) {
      var body = hits.slice(0, 10).map(function (r) { return r[0].slice(0, 4) + "." + r[0].slice(4, 6) + " " + r[2] + " " + Math.round(r[4]) + "㎡ " + Math.round(r[5]).toLocaleString() + "만원 (평당 " + Math.round(r[5] * 3.3058 / r[4]) + "만원)"; }).join("\n");
      MailApp.sendEmail(email, "[땅의 가치] " + li + " 새 토지 거래 " + hits.length + "건", v[i][3] + " 주변에 새로 신고된 토지 거래입니다.\n\n" + body + "\n\n내 땅 리포트 다시 보기: " + SITE + "land.html?addr=" + encodeURIComponent(v[i][3]) + "\n\n알림을 그만 받으려면 이 메일에 '수신거부'라고 답장해 주세요.");
    }
    sh.getRange(i + 1, 8).setValue(today);
  }
}
function setup() {  // 한 번만 실행: 매일 오전 8시 dailyCheck 예약
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "dailyCheck") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("dailyCheck").timeBased().everyDays(1).atHour(8).inTimezone("Asia/Seoul").create();
}
