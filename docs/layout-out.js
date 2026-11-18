/* 모듈 배치도 출력 — 입지검토(screen.html)의 배치 결과를 CAD풍 도면(SVG, A3 가로)과 DXF로 내보냄.
   입력(data): { title, addr, jibun, area, rings:[[[x,y],...]], tables:[{x,y,cols,rem}], p:{ st,tcol,w,l,kw,tilt,set,gap,pmin,pmax,dep,mods,kwp,tables,target,maxMods }, date }
   좌표 x,y는 미터(북쪽이 +y). 지형·지장물·건축물은 반영하지 않은 참고도. */
(function (root) {
  "use strict";
  var SCALES = [200, 250, 300, 400, 500, 600, 750, 1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000];
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function f1(v) { return Math.round(v * 10) / 10; }
  function nf(v) { return Math.round(v).toLocaleString("ko-KR"); }
  function bbox(d) {
    var x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
    (d.rings.concat(d.exRings || [])).forEach(function (r) { r.forEach(function (v) { x0 = Math.min(x0, v[0]); y0 = Math.min(y0, v[1]); x1 = Math.max(x1, v[0]); y1 = Math.max(y1, v[1]); }); });
    return [x0, y0, x1, y1];
  }
  function summary(d) {
    var p = d.p, cols = 0;
    d.tables.forEach(function (t) { cols += t.cols; });
    return { cols: cols };
  }

  /* ---------- SVG 도면 (단위 mm, 시트 420×297) ---------- */
  function svg(d) {
    var p = d.p, B = bbox(d), W = 420, H = 297, MX0 = 8, MY0 = 8, MX1 = 292, MY1 = 289;
    var bw = B[2] - B[0], bh = B[3] - B[1], ms = 0.9, avW = (MX1 - MX0 - 14), avH = (MY1 - MY0 - 14), sc = SCALES[SCALES.length - 1];
    for (var i = 0; i < SCALES.length; i++) { if (bw * 1000 / SCALES[i] <= avW * ms && bh * 1000 / SCALES[i] <= avH * ms) { sc = SCALES[i]; break; } }
    var k = 1000 / sc, ox = MX0 + 7 + (avW - bw * k) / 2, oy = MY1 - 7 - (avH - bh * k) / 2;
    function X(x) { return f1(ox + (x - B[0]) * k); }
    function Y(y) { return f1(oy - (y - B[1]) * k); }
    var o = [];
    o.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + 'mm" height="' + H + 'mm" font-family="\'Malgun Gothic\',\'Noto Sans CJK KR\',\'Apple SD Gothic Neo\',sans-serif">');
    o.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#fff"/><rect x="5" y="5" width="' + (W - 10) + '" height="' + (H - 10) + '" fill="none" stroke="#000" stroke-width="0.5"/>');
    o.push('<rect x="' + MX0 + '" y="' + MY0 + '" width="' + (MX1 - MX0) + '" height="' + (MY1 - MY0) + '" fill="#fbfbf7" stroke="#000" stroke-width="0.25"/>');
    // 필지
    d.rings.forEach(function (r) {
      o.push('<polygon points="' + r.map(function (v) { return X(v[0]) + "," + Y(v[1]); }).join(" ") + '" fill="#fff8d6" stroke="#9a6b00" stroke-width="0.35"/>');
    });
    (d.exRings || []).forEach(function (r, i) {
      o.push('<polygon points="' + r.map(function (v) { return X(v[0]) + "," + Y(v[1]); }).join(" ") + '" fill="#eeeeee" stroke="#888" stroke-width="0.3" stroke-dasharray="2 1.2"/>');
      var cx = 0, cy = 0; r.forEach(function (v) { cx += v[0]; cy += v[1]; }); cx /= r.length; cy /= r.length;
      o.push('<text x="' + X(cx) + '" y="' + Y(cy) + '" font-size="3.4" text-anchor="middle" fill="#666">' + esc((d.exLabels || [])[i] || "제외") + '</text>');
    });
    // 모듈 테이블
    var dep = p.dep, tw = p.w;
    d.tables.forEach(function (t) {
      var w = t.cols * tw, x = X(t.x), yTop = Y(t.y + dep), ww = f1(w * k), hh = f1(dep * k), pathd = "";
      o.push('<rect x="' + x + '" y="' + yTop + '" width="' + ww + '" height="' + hh + '" fill="#cfe0ff" stroke="#1f4fa8" stroke-width="0.12"/>');
      for (var c = 1; c < t.cols; c++) pathd += "M" + f1(x + c * tw * k) + " " + yTop + "v" + hh;
      for (var s = 1; s < p.st; s++) pathd += "M" + x + " " + f1(yTop + hh * s / p.st) + "h" + ww;
      if (pathd) o.push('<path d="' + pathd + '" stroke="#1f4fa8" stroke-width="0.05" fill="none"/>');
      if (t.rem) { // 마지막 열이 일부만 찬 경우: 비어있는 윗부분 표시
        var cx = f1(x + (t.cols - 1) * tw * k), eh = f1(hh * (p.st - t.rem) / p.st);
        o.push('<rect x="' + cx + '" y="' + yTop + '" width="' + f1(tw * k) + '" height="' + eh + '" fill="#fbfbf7" stroke="#1f4fa8" stroke-width="0.05"/>');
      }
    });
    // 지번 표기
    d.rings.forEach(function (r, i) {
      if (!d.labels || !d.labels[i]) return;
      var cx = 0, cy = 0; r.forEach(function (v) { cx += v[0]; cy += v[1]; }); cx /= r.length; cy /= r.length;
      o.push('<text x="' + X(cx) + '" y="' + Y(cy) + '" font-size="3.6" text-anchor="middle" fill="#7a5200" stroke="#fff" stroke-width="0.7" paint-order="stroke">' + esc(d.labels[i]) + '</text>');
    });
    // 북쪽 화살표
    var nx = MX1 - 18, ny = MY0 + 22;
    o.push('<g><circle cx="' + nx + '" cy="' + ny + '" r="7" fill="#fff" stroke="#000" stroke-width="0.3"/><path d="M' + nx + ' ' + (ny - 6) + 'L' + (nx + 3) + ' ' + (ny + 4) + 'L' + nx + ' ' + (ny + 2) + 'L' + (nx - 3) + ' ' + (ny + 4) + 'Z" fill="#000"/><text x="' + nx + '" y="' + (ny - 8.5) + '" font-size="4" text-anchor="middle" font-weight="700">N</text></g>');
    // 축척바
    var bl = [10, 20, 25, 50, 100, 200, 500].filter(function (v) { return v * k <= 60; }).pop() || 10, bx = MX0 + 10, by = MY1 - 8;
    o.push('<g><rect x="' + bx + '" y="' + (by - 2) + '" width="' + f1(bl * k / 2) + '" height="2" fill="#000"/><rect x="' + f1(bx + bl * k / 2) + '" y="' + (by - 2) + '" width="' + f1(bl * k / 2) + '" height="2" fill="#fff" stroke="#000" stroke-width="0.25"/><text x="' + bx + '" y="' + (by - 3.5) + '" font-size="3.4">0</text><text x="' + f1(bx + bl * k) + '" y="' + (by - 3.5) + '" font-size="3.4" text-anchor="end">' + bl + 'm</text></g>');
    // ---- 우측 패널 ----
    var PX = 296, PW = 119, y = 10;
    function box(h, title) { o.push('<rect x="' + PX + '" y="' + y + '" width="' + PW + '" height="' + h + '" fill="#fff" stroke="#000" stroke-width="0.3"/>'); if (title) o.push('<rect x="' + PX + '" y="' + y + '" width="' + PW + '" height="6.5" fill="#222"/><text x="' + (PX + PW / 2) + '" y="' + (y + 4.7) + '" font-size="3.8" fill="#fff" text-anchor="middle" font-weight="700">' + esc(title) + '</text>'); }
    // 설계개요표
    var kwp = p.kwp, rows = [
      ["사업명", d.title],
      ["위치", d.addr],
      ["지번", d.jibun],
      ["대지면적", nf(d.area) + " ㎡ (" + f1(d.area / 3.3058) + "평)"],
      ["발전방식", "태양광 · 고정형 · 정남향 · 모듈각 " + p.tilt + "°" + (p.shade ? " · 음영각 " + p.shade + "°" : "")],
      ["모듈", f1(p.kw * 1000) + " Wp (" + Math.round(p.l * 1000) + " × " + Math.round(p.w * 1000) + " mm)"],
      ["어레이", p.st + "단 × 최대 " + p.tcol + "열 / 테이블 " + d.tables.length + "개"],
      ["설치 장수", nf(p.mods) + " 장" + (p.target ? " (목표 " + nf(p.target) + "장" + (p.maxMods < p.target ? " · 부지 한계 " + nf(p.maxMods) + "장" : "") + ")" : "")],
      ["설치 용량", f1(kwp) + " kWp (" + f1(kwp / 1000 * 1000) / 1000 + " MWp)"],
      ["어레이 줄 간격", (p.pmin === p.pmax ? p.pmin : p.pmin + " ~ " + p.pmax) + " m (" + (p.shade ? "음영각 " + p.shade + "° 기준" : "동지 오전 9시 무음영") + ")"],
      ["모듈 간격", Math.round((p.mg || 0) * 1000) + " mm (단 사이)"],
      ["이격", "경계 " + p.set + " m · 제외구역 " + p.gap + " m"],
      ["비고", (d.note ? d.note + " " : "") + "입지검토 자동배치 참고도 — 지형·지장물·진입로 미반영, 실시설계 별도"]
    ];
    var lh = 6.4;
    function wrap(v, n) { var out = [], t = String(v); while (t.length > n) { out.push(t.slice(0, n)); t = t.slice(n); } out.push(t); return out; }
    var wr = rows.map(function (r) { return wrap(r[1], 40); }), tot = 0;
    wr.forEach(function (w) { tot += (w.length > 1 ? 3.6 * w.length + 2.8 : lh); });
    var hh = 6.5 + tot + 1;
    box(hh, "설 계 개 요");
    var yy = y + 6.5;
    rows.forEach(function (r, i) {
      var w = wr[i], rh = w.length > 1 ? 3.6 * w.length + 2.8 : lh;
      o.push('<line x1="' + PX + '" y1="' + f1(yy + rh) + '" x2="' + (PX + PW) + '" y2="' + f1(yy + rh) + '" stroke="#999" stroke-width="0.15"/><line x1="' + (PX + 26) + '" y1="' + f1(yy) + '" x2="' + (PX + 26) + '" y2="' + f1(yy + rh) + '" stroke="#999" stroke-width="0.15"/>');
      o.push('<text x="' + (PX + 2) + '" y="' + f1(yy + 4.4) + '" font-size="3.3" font-weight="700">' + esc(r[0]) + '</text>');
      w.forEach(function (ln, k) { o.push('<text x="' + (PX + 28) + '" y="' + f1(yy + (w.length > 1 ? 4.2 + 3.6 * k : 4.4)) + '" font-size="' + (w.length > 1 ? 2.9 : 3.3) + '">' + esc(ln) + '</text>'); });
      yy += rh;
    });
    y += hh + 4;
    // 구조물 단면 (S=1/100)
    var sh = 62;
    box(sh, "구조물 측면도 (" + p.st + "단) S=1/100");
    var tl = p.st * p.l + (p.st - 1) * (p.mg || 0), ang = p.tilt * Math.PI / 180, hgt = tl * Math.sin(ang), dp = tl * Math.cos(ang), low = 0.5, S = 10, bx0 = PX + 18, gy = y + sh - 12;
    var pxA = bx0, pyA = gy - low * S, pxB = bx0 + dp * S, pyB = gy - (low + hgt) * S;
    o.push('<line x1="' + (PX + 4) + '" y1="' + gy + '" x2="' + (PX + PW - 4) + '" y2="' + gy + '" stroke="#555" stroke-width="0.35"/><text x="' + (PX + PW - 5) + '" y="' + (gy + 3.6) + '" font-size="3" text-anchor="end">G.L</text>');
    o.push('<line x1="' + f1(pxA) + '" y1="' + f1(pyA) + '" x2="' + f1(pxB) + '" y2="' + f1(pyB) + '" stroke="#1f4fa8" stroke-width="1.2"/>');
    o.push('<line x1="' + f1(pxA) + '" y1="' + f1(pyA) + '" x2="' + f1(pxA) + '" y2="' + gy + '" stroke="#444" stroke-width="0.6"/><line x1="' + f1(pxB) + '" y1="' + f1(pyB) + '" x2="' + f1(pxB) + '" y2="' + gy + '" stroke="#444" stroke-width="0.6"/>');
    o.push('<line x1="' + f1(pxA) + '" y1="' + gy + '" x2="' + f1(pxB) + '" y2="' + gy + '" stroke="#c00" stroke-width="0.2" stroke-dasharray="1.5 1"/>');
    o.push('<text x="' + f1((pxA + pxB) / 2) + '" y="' + (gy + 5.2) + '" font-size="3" text-anchor="middle">수평 ' + f1(dp) + ' m</text>');
    o.push('<text x="' + f1(pxB + 3) + '" y="' + f1((pyB + gy) / 2) + '" font-size="3">상단고 ' + f1(low + hgt) + ' m</text>');
    o.push('<text x="' + f1(pxA - 2) + '" y="' + f1(pyA - 2) + '" font-size="3" text-anchor="end">하단 ' + low + ' m</text>');
    o.push('<text x="' + f1((pxA + pxB) / 2 - 8) + '" y="' + f1((pyA + pyB) / 2 - 3) + '" font-size="3" transform="rotate(' + (-p.tilt) + ' ' + f1((pxA + pxB) / 2 - 8) + ' ' + f1((pyA + pyB) / 2 - 3) + ')">경사면 ' + f1(tl) + ' m</text>');
    o.push('<path d="M' + f1(pxA + 10) + ' ' + f1(pyA) + 'A10 10 0 0 0 ' + f1(pxA + 10 * Math.cos(ang)) + ' ' + f1(pyA - 10 * Math.sin(ang)) + '" fill="none" stroke="#c00" stroke-width="0.3"/><text x="' + f1(pxA + 12) + '" y="' + f1(pyA - 1.2) + '" font-size="3" fill="#c00">' + p.tilt + '°</text>');
    y += sh + 4;
    // 범례
    box(24, "범 례");
    o.push('<rect x="' + (PX + 4) + '" y="' + (y + 9) + '" width="9" height="4.5" fill="#fff8d6" stroke="#9a6b00" stroke-width="0.3"/><text x="' + (PX + 15) + '" y="' + (y + 12.6) + '" font-size="3.2">사업 대상 필지 경계</text>');
    o.push('<rect x="' + (PX + 4) + '" y="' + (y + 16) + '" width="9" height="4.5" fill="#cfe0ff" stroke="#1f4fa8" stroke-width="0.3"/><text x="' + (PX + 15) + '" y="' + (y + 19.6) + '" font-size="3.2">모듈 테이블 (' + p.st + '단 세로 설치)</text>');
    y += 28;
    // 표제란
    var th = 297 - 10 - y;
    o.push('<rect x="' + PX + '" y="' + y + '" width="' + PW + '" height="' + th + '" fill="#fff" stroke="#000" stroke-width="0.4"/>');
    o.push('<text x="' + (PX + PW / 2) + '" y="' + (y + 8) + '" font-size="4.2" text-anchor="middle" font-weight="700">' + esc(d.title) + '</text>');
    o.push('<text x="' + (PX + PW / 2) + '" y="' + (y + 15) + '" font-size="5" text-anchor="middle" font-weight="700">모 듈 배 치 도 (참고)</text>');
    o.push('<text x="' + (PX + 3) + '" y="' + (y + th - 9) + '" font-size="3.2">축척 1 / ' + sc + ' (A3)</text><text x="' + (PX + 3) + '" y="' + (y + th - 4) + '" font-size="3.2">작성일 ' + esc(d.date) + '</text>');
    o.push('<text x="' + (PX + PW - 3) + '" y="' + (y + th - 4) + '" font-size="3" text-anchor="end" fill="#555">태양광 입지검토 자동배치</text>');
    o.push('</svg>');
    return o.join("");
  }

  function openSheet(d) {
    var w = root.open("", "_blank");
    if (!w) { alert("팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 눌러 주세요."); return; }
    var html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>' + esc(d.title) + ' 모듈 배치도</title>' +
      '<style>@page{size:A3 landscape;margin:0}html,body{margin:0;background:#888}svg{display:block;margin:0 auto;background:#fff;max-width:100vw;height:auto}' +
      '.bar{position:sticky;top:0;background:#222;color:#fff;padding:8px 12px;font:14px sans-serif;display:flex;gap:8px;align-items:center;z-index:9}.bar button{padding:6px 12px;font-size:14px;cursor:pointer}' +
      '@media print{.bar{display:none}html,body{background:#fff}svg{width:420mm;height:297mm;max-width:none}}</style></head><body>' +
      '<div class="bar"><button onclick="window.print()">인쇄 / PDF 저장 (A3 가로)</button><span>인쇄 창에서 대상을 \'PDF로 저장\'으로 선택하세요. 배경 그래픽 옵션은 켜 두는 것이 좋습니다.</span></div>' + svg(d) + '</body></html>';
    w.document.open(); w.document.write(html); w.document.close();
  }

  /* ---------- DXF (AC1009, 단위 m, 한글은 \U+XXXX 로 인코딩) ---------- */
  function dxfText(s) { var r = ""; String(s).split("").forEach(function (c) { var n = c.charCodeAt(0); r += n > 126 ? "\\U+" + ("0000" + n.toString(16).toUpperCase()).slice(-4) : c; }); return r; }
  function dxf(d) {
    var p = d.p, o = [];
    function g(c, v) { o.push(String(c)); o.push(String(v)); }
    var LAYERS = [["PARCEL", 2], ["MODULE", 5], ["TEXT", 7], ["FRAME", 8]];
    g(0, "SECTION"); g(2, "HEADER"); g(9, "$ACADVER"); g(1, "AC1009"); g(9, "$INSUNITS"); g(70, 6); g(0, "ENDSEC");
    g(0, "SECTION"); g(2, "TABLES");
    g(0, "TABLE"); g(2, "LTYPE"); g(70, 1); g(0, "LTYPE"); g(2, "CONTINUOUS"); g(70, 0); g(3, "Solid line"); g(72, 65); g(73, 0); g(40, 0); g(0, "ENDTAB");
    g(0, "TABLE"); g(2, "LAYER"); g(70, LAYERS.length); LAYERS.forEach(function (l) { g(0, "LAYER"); g(2, l[0]); g(70, 0); g(62, l[1]); g(6, "CONTINUOUS"); }); g(0, "ENDTAB");
    g(0, "TABLE"); g(2, "STYLE"); g(70, 1); g(0, "STYLE"); g(2, "KOR"); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 2.5); g(3, "malgun.ttf"); g(4, ""); g(0, "ENDTAB");
    g(0, "ENDSEC");
    g(0, "SECTION"); g(2, "ENTITIES");
    function poly(layer, pts, closed) { g(0, "POLYLINE"); g(8, layer); g(66, 1); g(70, closed ? 1 : 0); pts.forEach(function (v) { g(0, "VERTEX"); g(8, layer); g(10, f4(v[0])); g(20, f4(v[1])); g(30, 0); }); g(0, "SEQEND"); g(8, layer); }
    function f4(v) { return Math.round(v * 10000) / 10000; }
    function text(x, y, h, s, layer) { g(0, "TEXT"); g(8, layer || "TEXT"); g(7, "KOR"); g(10, f4(x)); g(20, f4(y)); g(30, 0); g(40, h); g(1, dxfText(s)); }
    d.rings.forEach(function (r) { poly("PARCEL", r, true); });
    var dep = p.dep;
    d.tables.forEach(function (t) {
      var w = t.cols * p.w;
      poly("MODULE", [[t.x, t.y], [t.x + w, t.y], [t.x + w, t.y + dep], [t.x, t.y + dep]], true);
    });
    var B = bbox(d), ts = Math.max(1.5, Math.round(Math.max(B[2] - B[0], B[3] - B[1]) / 120 * 10) / 10), x0 = B[2] + ts * 4, y0 = B[3];
    text(x0, y0, ts * 1.6, d.title + " 모듈 배치도 (참고)");
    [["위치", d.addr], ["지번", d.jibun], ["대지면적", nf(d.area) + " ㎡"], ["모듈", f1(p.kw * 1000) + "Wp (" + Math.round(p.l * 1000) + "x" + Math.round(p.w * 1000) + "mm)"],
      ["어레이", p.st + "단 x 최대 " + p.tcol + "열, 모듈각 " + p.tilt + "도" + (p.shade ? ", 음영각 " + p.shade + "도" : "") + ", 정남향"], ["설치 장수", nf(p.mods) + " 장"], ["설치 용량", f1(p.kwp) + " kWp"],
      ["줄 간격", (p.pmin === p.pmax ? p.pmin : p.pmin + "~" + p.pmax) + " m"], ["이격", "경계 " + p.set + "m / 제외구역 " + p.gap + "m"], ["작성일", d.date]
    ].forEach(function (r, i) { text(x0, y0 - ts * 3.2 * (i + 1), ts, r[0] + " : " + r[1]); });
    text(B[0], B[1] - ts * 2, ts, "입지검토 자동배치 참고도 — 지형·지장물 미반영");
    g(0, "ENDSEC"); g(0, "EOF");
    return o.join("\r\n") + "\r\n";
  }
  function download(name, str) {
    var a = root.document.createElement("a"), url = URL.createObjectURL(new Blob([str], { type: "application/dxf" }));
    a.href = url; a.download = name; root.document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
  }
  var api = { svg: svg, dxf: dxf, openSheet: openSheet, downloadDxf: function (d) { download((d.title || "배치도").replace(/[\\/:*?"<>|\s]+/g, "_") + "_배치도.dxf", dxf(d)); } };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.BFLayoutOut = api;
})(typeof window !== "undefined" ? window : globalThis);
