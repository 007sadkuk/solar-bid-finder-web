/* 태양광 사전 스크리닝 엔진
   필지 경계 안을 일정 간격 격자로 나눠, 칸마다 [필지·용도지역·생태자연도 등급·경사]를 붙인 뒤 판정 기준(screen-rules.js)으로 면적을 셈.
   - 지적·용도지역: 브이월드 연속지적도/용도지역 레이어(지적 좌표 그대로)
   - 생태자연도·경사·건물: 실제 위치 기준 → 지적 좌표가 밀린 지역은 BFGeo.shiftAt 보정값만큼 옮겨서 조회
   필요: geo.js(BFGeo), site-config.js(KT_CFG.endpoint: 생태자연도 중계) */
(function () {
  var R = window.SCREEN_RULES, CFG = window.KT_CFG || {};
  var SIDO = { "충남": "충청남도", "충북": "충청북도", "경북": "경상북도", "경남": "경상남도", "전남": "전라남도", "전북": "전북특별자치도", "강원": "강원특별자치도", "경기": "경기도", "대구": "대구광역시", "부산": "부산광역시", "울산": "울산광역시", "광주": "광주광역시", "대전": "대전광역시", "세종": "세종특별자치시", "제주": "제주특별자치도", "서울": "서울특별시", "인천": "인천광역시" };

  function polys(G) { if (!G) return []; if (G.type === "Polygon") return [G.coordinates[0]]; if (G.type === "MultiPolygon") return G.coordinates.map(function (p) { return p[0]; }); return []; }
  function pip(pt, r) { var x = pt[0], y = pt[1], c = false; for (var i = 0, j = r.length - 1; i < r.length; j = i++) { var a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
  function bbox(r) { var b = [Infinity, Infinity, -Infinity, -Infinity]; r.forEach(function (p) { if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; }); return b; }
  function inB(p, b) { return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]; }
  function tm5186(lon, lat) { var a = 6378137, f = 1 / 298.257222101, e2 = f * (2 - f), ep2 = e2 / (1 - e2), lat0 = 38 * Math.PI / 180, lon0 = 127 * Math.PI / 180;
    function M(p) { return a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * p - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * p) + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * p) - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * p)); }
    var p = lat * Math.PI / 180, l = lon * Math.PI / 180, N = a / Math.sqrt(1 - e2 * Math.pow(Math.sin(p), 2)), T = Math.pow(Math.tan(p), 2), C = ep2 * Math.pow(Math.cos(p), 2), A = (l - lon0) * Math.cos(p);
    return [200000 + N * (A + (1 - T + C) * Math.pow(A, 3) / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5) / 120),
      600000 + (M(p) - M(lat0) + N * Math.tan(p) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6) / 720))]; }

  /* ── 입력 해석: "…명천리 214, 214-3, 산140" 또는 줄마다 전체 주소 ── */
  function parseInput(txt) {
    var out = [], prefix = "";
    String(txt || "").split(/[\n,;]+/).map(function (s) { return s.replace(/\s+/g, " ").trim(); }).filter(Boolean).forEach(function (s) {
      s = s.replace(/^(\S+)/, function (m) { return SIDO[m] || m; }).replace(/번지$/, "");
      if (/^(산\s?)?\d+(-\d+)?$/.test(s)) { if (prefix) out.push(prefix + " " + s.replace(/\s/g, "")); return; }
      var m = s.match(/^(.*\S)\s+(산\s?)?\d+(-\d+)?$/); if (m) prefix = m[1];
      out.push(s);
    });
    var seen = {}; return out.filter(function (a) { if (seen[a]) return false; seen[a] = 1; return true; });
  }

  /* ── 표고(Mapzen Terrarium 타일, z15) ── */
  var TILES = {}, Z = 15, NT = Math.pow(2, Z);
  function tpx(lon, lat) { var s = Math.sin(lat * Math.PI / 180); return [(lon + 180) / 360 * NT * 256, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * NT * 256]; }
  function loadTile(x, y) { var k = x + "/" + y; if (TILES[k]) return TILES[k].p;
    var o = { d: null }; o.p = new Promise(function (ok, no) { var img = new Image(); img.crossOrigin = "anonymous";
      img.onload = function () { var c = document.createElement("canvas"); c.width = c.height = 256; var g = c.getContext("2d"); g.drawImage(img, 0, 0); var d = g.getImageData(0, 0, 256, 256).data, e = new Float32Array(65536);
        for (var i = 0; i < 65536; i++) e[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768; o.d = e; ok(e); };
      img.onerror = function () { no(new Error("표고 타일을 받지 못했습니다")); };
      img.src = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/" + Z + "/" + x + "/" + y + ".png"; });
    TILES[k] = o; return o.p; }
  function demPrep(b) { var a = tpx(b[0], b[3]), c = tpx(b[2], b[1]), ps = [];
    for (var x = Math.floor(a[0] / 256) - 0; x <= Math.floor(c[0] / 256); x++) for (var y = Math.floor(a[1] / 256); y <= Math.floor(c[1] / 256); y++) ps.push(loadTile(x, y));
    return Promise.all(ps); }
  function elev(lon, lat) { var P = tpx(lon, lat), X = P[0] - 0.5, Y = P[1] - 0.5, x0 = Math.floor(X), y0 = Math.floor(Y), fx = X - x0, fy = Y - y0;
    function v(xx, yy) { var t = TILES[Math.floor(xx / 256) + "/" + Math.floor(yy / 256)]; if (!t || !t.d) return NaN; return t.d[(yy & 255) * 256 + (xx & 255)]; }
    return v(x0, y0) * (1 - fx) * (1 - fy) + v(x0 + 1, y0) * fx * (1 - fy) + v(x0, y0 + 1) * (1 - fx) * fy + v(x0 + 1, y0 + 1) * fx * fy; }

  /* ── 생태자연도(국립생태원 WFS, Apps Script 중계) ── */
  function ecoFetch(bReal) {
    if (!CFG.endpoint) return Promise.resolve({ err: "생태자연도 중계 주소(site-config.js) 없음" });
    var a = tm5186(bReal[0], bReal[1]), c = tm5186(bReal[2], bReal[3]), bb = [Math.min(a[0], c[0]) - 5, Math.min(a[1], c[1]) - 5, Math.max(a[0], c[0]) + 5, Math.max(a[1], c[1]) + 5].map(function (v) { return v.toFixed(1); }).join(",");
    var ac = new AbortController(), tm = setTimeout(function () { ac.abort(); }, 30000);
    return fetch(CFG.endpoint + "?action=eco&bbox=" + bb, { signal: ac.signal }).then(function (r) { return r.json(); }).then(function (j) { clearTimeout(tm);
      if (!j || !j.f) return { err: (j && j.error) || "응답 형식 이상" };
      return { attrs: j.f.some(function (f) { return f.length > 2; }), f: j.f.map(function (f) { return { g: String(f[0]), v: f.length > 2 ? String(f[2] || "") : null, pn: f[3] || "", x: f[5] || null, rs: f[1].map(function (r) { return { r: r, b: bbox(r) }; }) }; }) };
    }).catch(function (e) { clearTimeout(tm); return { err: e.name === "AbortError" ? "시간 초과(30초)" : e.message }; });
  }

  /* ── 산림청 산사태정보시스템 격자(10m): 경사(Slope), 산사태위험등급(hazard2025) — EPSG:5181 ── */
  var FS = "https://sansatai.forest.go.kr/gis1/ictout/iserver/services/data-HazardParam2025/rest/data/datasources/HazardParam2025/datasets/";
  var FSG = { Slope: { L: -11019.2162346517, T: 584060.6190678639, r: 10 }, hazard2025: { L: -7279.2162346516, T: 570000.6190678641, r: 10 } };
  async function forestGrid(pts5181, prog) { // pts: [[x,y],...] → {Slope: [..], hazard2025: [..]} (null = 값 없음)
    var out = { Slope: [], hazard2025: [] }, keys = {}, jobs = [];
    Object.keys(FSG).forEach(function (d) { var g = FSG[d]; pts5181.forEach(function (p, i) { var c = Math.floor((p[0] - g.L) / g.r), r = Math.floor((g.T - p[1]) / g.r), k = d + ":" + c + ":" + r; out[d][i] = k; if (!keys[k]) { keys[k] = { v: undefined }; jobs.push({ k: k, d: d, x: g.L + (c + 0.5) * g.r, y: g.T - (r + 0.5) * g.r }); } }); });
    if (jobs.length > 6000) throw new Error("사업지가 너무 커서 산림청 격자 조회를 건너뜀(" + jobs.length + "칸)");
    var done = 0, fail = 0, idx = 0;
    async function worker() { while (idx < jobs.length) { var j = jobs[idx++];
      try { var r = await fetch(FS + j.d + "/gridValue.json?x=" + j.x.toFixed(2) + "&y=" + j.y.toFixed(2)); var t = await r.json(); var v = t && t.value != null ? +t.value : null;
        if (v !== null && (v < -1e30 || v > 1e6 || (j.d === "hazard2025" && (v < 1 || v > 5)))) v = null; keys[j.k].v = v; } catch (e) { fail++; keys[j.k].v = null; }
      done++; if (prog && done % 50 === 0) prog("산림청 경사·산사태위험 격자를 받고 있습니다 (" + done + "/" + jobs.length + ")", 75 + Math.round(done / jobs.length * 15)); } }
    var W = []; for (var w = 0; w < 16; w++) W.push(worker()); await Promise.all(W);
    if (fail > jobs.length * 0.3) throw new Error("산림청 격자 조회 실패 " + fail + "/" + jobs.length);
    Object.keys(out).forEach(function (d) { out[d] = out[d].map(function (k) { return keys[k].v; }); });
    out.n = jobs.length; out.fail = fail; return out; }

  async function allFeatures(layer, b, maxPage) { var out = []; for (var pg = 1; pg <= (maxPage || 3); pg++) {
      var q = await BFGeo.vwData(layer, { geomFilter: "BOX(" + b.join(",") + ")", size: "1000", page: String(pg) }).catch(function () { return { status: "ERR", features: [] }; });
      out = out.concat(q.features || []); if (!q.features || q.features.length < 1000) break; } return out; }

  function segDist(p, a, b, kx, ky) { var px = (p[0] - a[0]) * kx, py = (p[1] - a[1]) * ky, bx = (b[0] - a[0]) * kx, by = (b[1] - a[1]) * ky, L = bx * bx + by * by, t = L ? Math.max(0, Math.min(1, (px * bx + py * by) / L)) : 0; return Math.hypot(px - t * bx, py - t * by); }
  function ringDist(p, r, kx, ky) { var m = Infinity; for (var i = 0; i < r.length - 1; i++) { var d = segDist(p, r[i], r[i + 1], kx, ky); if (d < m) m = d; } return m; }

  /* ── 실행: 데이터 수집 + 격자 표본 ── */
  async function run(text, prog) {
    prog = prog || function () {};
    var addrs = parseInput(text); if (!addrs.length) throw new Error("지번을 입력하세요");
    if (addrs.length > 30) throw new Error("한 번에 30필지까지 됩니다");
    var P = [], miss = [];
    prog("필지를 찾고 있습니다", 5);
    for (var i = 0; i < addrs.length; i++) {
      var f = await BFGeo.findParcel(addrs[i]).catch(function () { return null; });
      if (!f) { miss.push(addrs[i]); continue; }
      if (P.some(function (p) { return p.pnu === f.pnu; })) continue;
      var g = await BFGeo.vwData("LP_PA_CBND_BUBUN", { attrFilter: "pnu:=:" + f.pnu, size: "1" });
      var rings = g.features && g.features[0] ? polys(g.features[0].geometry) : [];
      if (!rings.length) { miss.push(addrs[i]); continue; }
      var ji = BFGeo.jibunInfo(f.jibun);
      P.push({ input: addrs[i], pnu: f.pnu, addr: f.addr, jibun: String(f.jibun).replace(/\s*\S$/, "").trim() || f.jibun, jimok: ji.name, jcode: ji.code, rings: rings.map(function (r) { return { r: r, b: bbox(r) }; }) });
    }
    if (!P.length) throw new Error("찾은 필지가 없습니다: " + miss.join(", "));
    var all = []; P.forEach(function (p) { p.rings.forEach(function (o) { all = all.concat(o.r); }); });
    var B = bbox(all), lat0 = (B[1] + B[3]) / 2, lon0 = (B[0] + B[2]) / 2, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
    P.forEach(function (p) { p.area = 0; p.rings.forEach(function (o) { var s = 0, r = o.r; for (var i = 0; i < r.length - 1; i++) s += (r[i][0] - lon0) * kx * (r[i + 1][1] - lat0) * ky - (r[i + 1][0] - lon0) * kx * (r[i][1] - lat0) * ky; p.area += Math.abs(s) / 2; }); });

    prog("지적 위치를 확인하고 있습니다", 15);
    var SH = await BFGeo.shiftAt(lon0, lat0).catch(function () { return null; }), dx = SH ? SH.dx : 0, dy = SH ? SH.dy : 0;
    var Breal = [B[0] + dx, B[1] + dy, B[2] + dx, B[3] + dy];
    function pad(b, m) { return [b[0] - m / kx, b[1] - m / ky, b[2] + m / kx, b[3] + m / ky]; }

    prog("용도지역·토지이용계획·생태자연도·표고를 받고 있습니다", 25);
    var zoneP = Promise.all(["LT_C_UQ111", "LT_C_UQ112", "LT_C_UQ113", "LT_C_UQ114"].map(function (L) { return allFeatures(L, B, 2); }));
    var nedP = Promise.all(P.map(function (p) { return BFGeo.nedQuery(p.pnu).then(function (x) { return x; }).catch(function (e) { return { err: e.message }; }); }));
    var lcP = Promise.all(P.map(function (p) { return BFGeo.landChar(p.pnu).catch(function () { return null; }); }));
    var ecoP = ecoFetch(Breal);
    var demP = demPrep(pad(Breal, 40)).then(function () { return null; }).catch(function (e) { return e.message; });
    var nbP = allFeatures("LP_PA_CBND_BUBUN", pad(B, 25), 2);
    var bldP = allFeatures("LT_C_SPBD", pad(Breal, R.houses.far + 20), 3);
    var zr = await zoneP, ned = await nedP, eco = await ecoP, demErr = await demP, nb = await nbP, bld = await bldP;

    var zones = []; zr.forEach(function (fs) { fs.forEach(function (f) { var pr = f.properties || {}; polys(f.geometry).forEach(function (r) { zones.push({ n: pr.uname || "?", y: pr.dyear || "", r: r, b: bbox(r) }); }); }); });
    var lc = await lcP; P.forEach(function (p, i) { p.ned = ned[i]; p.lc = lc[i]; });

    prog("필지 안을 격자로 나눠 계산하고 있습니다", 70);
    var area = 0; P.forEach(function (p) { area += p.area; });
    var step = Math.max(2, Math.sqrt(area / 9000)), dlon = step / kx, dlat = step / ky, H = 5;
    var nx = Math.ceil((B[2] - B[0]) / dlon), ny = Math.ceil((B[3] - B[1]) / dlat), cells = [];
    for (var ix = 0; ix < nx; ix++) for (var iy = 0; iy < ny; iy++) {
      var q = [B[0] + (ix + 0.5) * dlon, B[1] + (iy + 0.5) * dlat], pi = -1;
      for (var k = 0; k < P.length && pi < 0; k++) if (P[k].rings.some(function (o) { return inB(q, o.b) && pip(q, o.r); })) pi = k;
      if (pi < 0) continue;
      var zn = null; for (var z = 0; z < zones.length; z++) if (inB(q, zones[z].b) && pip(q, zones[z].r)) { zn = zones[z].n; break; }
      var rl = [q[0] + dx, q[1] + dy], eg = null, ev = null, epn = "", ex = null;
      if (eco.f) { var t = tm5186(rl[0], rl[1]); for (var e = 0; e < eco.f.length && !eg; e++) if (eco.f[e].rs.some(function (o) { return inB(t, o.b) && pip(t, o.r); })) { eg = eco.f[e].g; ev = eco.f[e].v || null; epn = eco.f[e].pn; ex = eco.f[e].x; } }
      var sl = null, el = null;
      if (!demErr) { el = elev(rl[0], rl[1]); if (!isFinite(el)) el = null; var gx = (elev(rl[0] + H / kx, rl[1]) - elev(rl[0] - H / kx, rl[1])) / (2 * H), gy = (elev(rl[0], rl[1] + H / ky) - elev(rl[0], rl[1] - H / ky)) / (2 * H); if (isFinite(gx) && isFinite(gy)) sl = Math.atan(Math.hypot(gx, gy)) * 180 / Math.PI; }
      cells.push({ ix: ix, iy: iy, p: pi, z: zn, e: eg, v: ev, pn: epn, x: ex, s: sl, el: el, mx: (q[0] - B[0]) * kx, my: (q[1] - B[1]) * ky });
    }
    // 칸 면적: 필지마다 실제 면적에 맞춤
    P.forEach(function (p, i) { var n = cells.filter(function (c) { return c.p === i; }).length; p.cellA = n ? p.area / n : 0; p.n = n; });
    // 산림청 10m 경사·산사태위험등급으로 덮어쓰기(실패하면 위 표고 계산값 유지)
    var fsErr = null, fsN = 0;
    try { var p5181 = cells.map(function (c) { var rx = B[0] + (c.ix + 0.5) * dlon + dx, ry = B[1] + (c.iy + 0.5) * dlat + dy, t = tm5186(rx, ry); return [t[0], t[1] - 100000]; });
      var FG = await forestGrid(p5181, prog); fsN = FG.n;
      cells.forEach(function (c, i) { c.sd = c.s; var sv = FG.Slope[i]; if (sv !== null && sv !== undefined) { c.s = sv; c.sf = 1; } c.hz = FG.hazard2025[i]; });
    } catch (e) { fsErr = e.message; }

    // 진입로(지적상 도로 접함), 이웃 산림
    var mine = {}; P.forEach(function (p) { mine[p.pnu] = 1; });
    var roads = [], forestNb = {};
    // 경계를 1m 간격으로 따라가며 다른 필지와 맞닿은 길이(m)
    function shared(A, Bs) { var L = 0; for (var i = 0; i < A.length - 1; i++) { var a = A[i], b = A[i + 1], len = Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky), n = Math.max(1, Math.ceil(len)); for (var k = 0; k < n; k++) { var t = (k + 0.5) / n, pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; if (Bs.some(function (r) { return ringDist(pt, r, kx, ky) < 0.6; })) L += len / n; } } return L; }
    nb.forEach(function (f) { var pr = f.properties || {}; if (mine[String(pr.pnu)]) return; var ji = BFGeo.jibunInfo(pr.jibun); if (!/^(도|임)$/.test(ji.code)) return;
      var rs = polys(f.geometry), touch = [];
      P.forEach(function (p, i) { var bx = p.rings.reduce(function (m, o) { return [Math.min(m[0], o.b[0]), Math.min(m[1], o.b[1]), Math.max(m[2], o.b[2]), Math.max(m[3], o.b[3])]; }, [Infinity, Infinity, -Infinity, -Infinity]);
        if (!rs.some(function (r) { var rb = bbox(r); return rb[0] <= bx[2] + 1e-5 && rb[2] >= bx[0] - 1e-5 && rb[1] <= bx[3] + 1e-5 && rb[3] >= bx[1] - 1e-5; })) return;
        var L = p.rings.reduce(function (s, o) { return s + shared(o.r, rs); }, 0); if (L > 0.5) touch.push({ i: i, L: L }); });
      if (!touch.length) return;
      if (ji.code === "도") roads.push({ jibun: String(pr.jibun), touch: touch }); else touch.forEach(function (t) { if (t.L >= 2) forestNb[t.i] = (forestNb[t.i] || 0) + 1; }); });
    // 사업지 안 지목 '임' 필지와 맞닿은 경작지도 산림 연접으로 봄
    P.forEach(function (p, i) { if (p.jcode !== "임") return; P.forEach(function (q, j) { if (i === j || forestNb[j]) return;
      var L = q.rings.reduce(function (s, o) { return s + shared(o.r, p.rings.map(function (x) { return x.r; })); }, 0); if (L >= 2) forestNb[j] = (forestNb[j] || 0) + 1; }); });

    // 정맥(9정맥 종주코스 선형) — 실제 위치 기준 최단거리
    var ridge = null;
    try { var TT = 0.2, tl = [], rb = pad(Breal, 3000);
      for (var tx = Math.floor(rb[0] / TT); tx <= Math.floor(rb[2] / TT); tx++) for (var ty = Math.floor(rb[1] / TT); ty <= Math.floor(rb[3] / TT); ty++) tl.push(tx + "_" + ty);
      var segs = [].concat.apply([], await Promise.all(tl.map(function (k) { return fetch("ridges/" + k + ".json").then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }); })));
      var best = { d: Infinity, n: "" }, RR = []; P.forEach(function (p) { p.rings.forEach(function (o) { RR.push(o.r.map(function (v) { return [v[0] + dx, v[1] + dy]; })); }); });
      segs.forEach(function (sg) { var pl = sg[1]; for (var i = 0; i < pl.length; i++) { var v = pl[i];
          if (v[0] < rb[0] || v[0] > rb[2] || v[1] < rb[1] || v[1] > rb[3]) continue;
          if (RR.some(function (r) { return pip(v, r); })) { best = { d: 0, n: sg[0] }; return; }
          RR.forEach(function (r) { var dd = ringDist(v, r, kx, ky); if (dd < best.d) best = { d: dd, n: sg[0] }; });
          if (i > 0) RR.forEach(function (r) { r.forEach(function (q) { var dd = segDist(q, pl[i - 1], v, kx, ky); if (dd < best.d) best = { d: dd, n: sg[0] }; }); }); } });
      ridge = { d: isFinite(best.d) ? Math.round(best.d) : null, n: best.n, tiles: tl.length };
    } catch (e) { ridge = { err: e.message }; }

    // 주변 건물(도로명주소 건물) — 실제 위치 기준, 사업지 안 건물 제외
    var realRings = []; P.forEach(function (p) { p.rings.forEach(function (o) { realRings.push(o.r.map(function (v) { return [v[0] + dx, v[1] + dy]; })); }); });
    var houses = [];
    bld.forEach(function (f) { var pr = f.properties || {}, sn = String(pr.bd_mgt_sn || "").slice(0, 19); var r0 = polys(f.geometry)[0]; if (!r0) return; var cx = 0, cy = 0; r0.forEach(function (v) { cx += v[0]; cy += v[1]; }); cx /= r0.length; cy /= r0.length;
      if (mine[sn]) return; var inside = realRings.some(function (r) { return pip([cx, cy], r); }); if (inside) return;
      var d = Infinity; r0.forEach(function (v) { realRings.forEach(function (r) { var dd = ringDist(v, r, kx, ky); if (dd < d) d = dd; }); });
      if (d <= R.houses.far) houses.push({ d: Math.round(d), name: (pr.rd_nm || "") + " " + (pr.buld_no || "") + (pr.buld_nm ? " " + pr.buld_nm : ""), pnu: sn, c: [cy, cx] }); });
    houses.sort(function (a, b) { return a.d - b.d; });
    // 건축물대장 주용도(Apps Script 중계, 건축HUB) — 실패해도 계속
    var bldUse = null;
    if (CFG.endpoint && houses.length) { try { var pl = uniqA(houses.map(function (h) { return h.pnu; })).slice(0, 40);
      var bj = await fetch(CFG.endpoint + "?action=bld&pnu=" + pl.join(",")).then(function (r) { return r.json(); });
      if (bj && bj.b) { bldUse = bj.b; houses.forEach(function (h) { h.use = bldUse[h.pnu] || null; }); } else bldUse = { _err: (bj && bj.error) || "응답 없음" }; } catch (e) { bldUse = { _err: e.message }; } }

    prog("판정하고 있습니다", 95);
    return { at: new Date(), P: P, miss: miss, B: B, step: step, dlon: dlon, dlat: dlat, nx: nx, ny: ny, cells: cells, shift: SH, kx: kx, ky: ky,
      fsErr: fsErr, fsN: fsN, ridge: ridge, sgg: P[0].pnu.slice(0, 5), eco: eco.err ? { err: eco.err } : { ok: true, n: eco.f.length, attrs: eco.attrs, extra: eco.f.some(function (f) { return !!f.x; }) }, bldUse: bldUse, demErr: demErr, zones: zones, roads: roads, forestNb: forestNb, houses: houses };
  }

  /* ── 판정: 식생보전등급 입력(veg2: 2등급 구간, vegP[i]: 필지별 그 밖의 구간)에 따라 다시 계산 ──
     식생 값: "3+" = Ⅲ등급 이상, "4" = Ⅳ등급, "4+" = Ⅳ등급 이상, "5" = Ⅴ등급 이하(농경지 등), "" = 모름 */
  function judge(D, veg2, vegP) {
    var S = R.slope, rows = [], P = D.P, sum = function (fn) { var a = 0; D.cells.forEach(function (c) { if (fn(c)) a += P[c.p].cellA; }); return Math.round(a); };
    /* 식생보전등급 판단: 생태자연도 '식생 평가등급'(vtn_evl_grad)이 있으면 그것으로, 없으면 사용자 입력으로.
       생태·자연도 작성지침: 식생 1등급 = 식생보전 Ⅰ·Ⅱ, 2등급 = Ⅲ·Ⅳ(또는 조사 안 된 자연식생 임상도 2영급 이상), 그 밖은 3등급(→ Ⅴ로 해석)
       ge3 = Ⅲ등급 이상인가, ge4 = Ⅳ등급 이상인가 (true / false / null=모름) */
    /* [추정 규칙] 생태자연도 식생 평가 2(= 식생보전 Ⅲ 또는 Ⅳ)를 군락명으로 나눔:
       식재림·조림 → Ⅳ, 초지·관목·덤불 → 판단 안 함, 그 밖의 자연림 군락 → Ⅲ.
       근거: 자연환경조사 식생보전등급 기준에서 인공식재림은 Ⅳ, 자연림(2차림 포함)은 Ⅲ 이상으로 보는 경우가 일반적. 에코뱅크 화면(곰솔-상수리나무군락 = Ⅲ)과 일치 */
    function commGe3(n) { if (/식재림|조림|식재/.test(n)) return false; if (/초지|관목|덤불|나지|경작|과수|묘포/.test(n)) return null; return /군락/.test(n) ? true : null; }
    function vegOf(c) {
      function inp(v) { return v === "3+" ? { ge3: true, ge4: true } : v === "4" ? { ge3: false, ge4: true } : v === "4+" ? { ge3: null, ge4: true } : v === "5" ? { ge3: false, ge4: false } : { ge3: null, ge4: null }; }
      if (c.v === "1") return { ge3: true, ge4: true, src: "eco" };
      if (c.v === "3") return { ge3: false, ge4: false, src: "eco" };
      if (c.v === "2") { var x = inp(veg2); if (x.ge3 === null && c.pn) { var g3 = commGe3(c.pn); if (g3 !== null) return { ge3: g3, ge4: true, src: "eco", est: true }; } return { ge3: x.ge3, ge4: true, src: "eco" }; }
      if (c.e === "2") return inp(veg2);
      if (vegP[c.p]) return inp(vegP[c.p]);
      var u = useOf(c.p); if (u) { var y = inp(u); y.est = true; y.src = "use"; return y; }
      return inp(""); }
    /* [추정] 생태자연도 식생 평가가 없는 곳: 토지특성 '이용상황'으로 식생 추정. 자연림·조림·임야 → Ⅳ 이상, 전·답·과수원·대지·공장 등 → Ⅴ */
    function useOf(i) { var u = (P[i].lc && P[i].lc.use) || ""; if (!u) return ""; if (/자연림|조림|임야|목장/.test(u)) return "4+"; if (/전|답|과수|주거|상업|공업|공장|대|창고|도로|하천|나지|주차|묘지|기타/.test(u)) return "5"; return ""; }
    function slopeSrc() { return fsCov > 0.95 ? "산림청 산사태정보시스템 경사 격자(10m)" : fsCov > 0 ? "산림청 경사 격자(10m) " + Math.round(fsCov * 100) + "% + 공개 표고(약 30m)" : "공개 표고(약 30m, Mapzen Terrarium)"; }
    function slopeNote() { return fsCov > 0.95 ? "경사는 산림청 산사태위험지도 작성용 10m 경사 격자 값(서산 명천리 검증: 15° 이상 7,000㎡ vs 보고서 7,036㎡). 허가 서류의 평균경사도는 산지관리법 방식으로 따로 산정" : fsCov > 0 ? "경사 일부(" + Math.round((1 - fsCov) * 100) + "%)는 산림청 격자 값이 없어 공개 표고로 계산 [추정, 실제보다 작게 나올 수 있음]" : "[추정] 산림청 경사 격자 조회 실패" + (D.fsErr ? "(" + D.fsErr + ")" : "") + " — 공개 표고(약 30m)로 계산해 실제보다 작게 나올 수 있음"; }
    var ecoOK = !D.eco.err, fsCov = D.cells.length ? D.cells.filter(function (c) { return c.sf; }).length / D.cells.length : 0, demOK = !D.demErr || fsCov > 0;
    // 칸별 상태: 2 = 회피, 1 = 신중, 3 = 식생 확인 시 회피 가능, 0 = 해당 없음
    D.cells.forEach(function (c) { var v = vegOf(c), st = 0, steep = c.s !== null && c.s >= S.avoid;
      if (c.e === "1") st = 2;
      else if (c.e === "2" && v.ge3 === true) st = 2;
      else if (steep && v.ge4 === true) st = 2;
      else if (c.e === "2" && v.ge3 === null) st = 3;
      else if (steep && v.ge4 === null) st = 3;
      else if (c.e === "2" && v.ge3 === false && v.ge4 === true && c.s !== null && c.s < S.avoid) st = 1;
      else if (/^(전|답|과)$/.test(P[c.p].jcode) && D.forestNb[c.p] && c.s !== null && c.s >= S.crop) st = 1;
      c.st = st; c.vg = v; });

    var ned = {}; P.forEach(function (p, i) { (Array.isArray(p.ned) ? p.ned : []).forEach(function (x) { var k = x[0]; (ned[k] = ned[k] || []).push({ i: i, c: x[1] }); }); });
    var nedErr = P.filter(function (p) { return p.ned && p.ned.err; }).map(function (p) { return p.jibun; });
    function legalHits(item) { var h = []; Object.keys(ned).forEach(function (k) { R.legal.forEach(function (L) { if (L.item === item && L.re.test(k)) h.push({ name: k, list: ned[k] }); }); }); return h; }
    function hitText(h) { return h.map(function (x) { return x.name + "(" + uniq(x.list.map(function (y) { return P[y.i].jibun + (y.c === "1" ? " 포함" : y.c === "2" ? " 저촉" : y.c === "3" ? " 접합" : ""); })).join(", ") + ")"; }).join(" · "); }
    function hitArea(h) { var s = {}; h.forEach(function (x) { x.list.forEach(function (y) { if (y.c !== "3") s[y.i] = 1; }); }); var a = 0; Object.keys(s).forEach(function (i) { a += P[i].area; }); return Math.round(a); }
    function V(group, id, title, verdict, ar, detail, basis, data) { rows.push({ g: group, id: id, t: title, v: verdict, a: ar, d: detail, b: basis, src: data }); }
    var G = "육상태양광 협의지침 — 입지 회피", G2 = "육상태양광 협의지침 — 신중 검토", G3 = "개발행위허가·인허가 사전 확인";
    var luSrc = "토지이용계획(브이월드 NED) " + D.at.toLocaleDateString("ko-KR") + " 조회";
    var nedNote = nedErr.length ? " (토지이용계획 조회 실패: " + nedErr.join(", ") + " → 그 필지는 확인 불가)" : "";

    // a) 백두대간·정맥
    var ha = legalHits("a"), rg = D.ridge || {}, rgOK = rg && !rg.err && rg.d !== undefined, rgNear = rgOK && rg.d !== null && rg.d <= R.ridgeNear;
    V(G, "a", "백두대간·정맥 보호지역, 주요 산줄기 능선축(기맥 좌우 100m, 지맥 50m)", ha.length ? "회피" : rgNear ? "회피(정맥 근접)" : "수동확인필요", ha.length ? hitArea(ha) : null,
      (ha.length ? hitText(ha) : "백두대간보호지역은 토지이용계획상 없음" + nedNote) + ". " +
        (rgOK ? (rg.d === null ? "가까운 9정맥 능선 없음(약 3km 안)" : "가장 가까운 정맥: " + rg.n + " 약 " + rg.d.toLocaleString() + "m" + (rgNear ? " — " + R.ridgeNear + "m 안" : "")) : "정맥 거리 계산 실패" + (rg.err ? "(" + rg.err + ")" : "")) +
        ". 기맥·지맥 선형은 공개 데이터가 없어 판정 못 함 — 산림청 산줄기 지도로 확인",
      "지침 입지회피 1", luSrc + " / 9정맥 종주코스 선형(한국등산트레킹지원센터, 공공데이터포털)");
    // b) 법정보호지역
    var hb = legalHits("b"), e9 = ecoOK ? sum(function (c) { return c.e === "9"; }) : 0;
    V(G, "b", "생태·경관보전지역, 야생생물보호구역, 습지보호지역, 상수원보호구역 등 법정보호지역", hb.length ? "회피" : nedErr.length === P.length ? "확인 불가" : e9 ? "수동확인필요" : "해당없음", hb.length ? hitArea(hb) : (e9 || null),
      (hb.length ? hitText(hb) : "토지이용계획에 해당 지역·지구 없음" + nedNote) + (e9 ? " / 생태자연도 '별도관리지역' " + e9.toLocaleString() + "㎡ — 지정 사유(법정보호지역 여부) 확인" : ""),
      "지침 입지회피 2", luSrc);
    // c) 법정보호종
    var ex = D.eco.extra, sm1 = ex ? A(function (c) { return c.x && c.x.smld === "1"; }) : 0, sm2 = ex ? A(function (c) { return c.x && c.x.smld === "2"; }) : 0,
      smN = {}; D.cells.forEach(function (c) { if (c.x && c.x.smldNm) smN[c.x.smldNm] = 1; });
    V(G, "c", "멸종위기 야생생물·천연기념물 등 법정보호종 서식지·산란처·철새도래지", !ex ? "수동확인필요" : sm1 ? "회피" : sm2 ? "수동확인필요" : "해당없음(생태자연도 기준)", ex ? (sm1 || sm2 || null) : null,
      ex ? (sm1 ? "생태자연도 '멸종위기 야생생물 서식' 평가 1등급 구간 " + sm1.toLocaleString() + "㎡" + (Object.keys(smN).length ? "(" + Object.keys(smN).join(", ") + ")" : "") + " — 서식 확인 지역. " : "생태자연도 멸종위기종 평가 1등급(서식 확인) 구간 없음. ") + (sm2 ? "평가 2등급(주변 서식 가능) " + sm2.toLocaleString() + "㎡. " : "") + "생태자연도에 반영 안 된 서식지·철새도래지는 현지조사로만 확인 가능" : "공개 위치 데이터 없음 — Apps Script를 새 코드로 배포하면 생태자연도 멸종위기종 평가가 자동 반영됨. 그 전에는 에코뱅크 '멸종위기 야생 생물 서식 여부'로 확인",
      "지침 입지회피 3", "국립생태원 생태자연도(멸종위기종 평가)");
    // d) 생태자연도 1등급
    var a1 = ecoOK ? sum(function (c) { return c.e === "1"; }) : null;
    V(G, "d", "생태·자연도 1등급(식생보전 Ⅰ-Ⅱ등급 / 비오톱 Ⅰ-Ⅱ등급)", !ecoOK ? "확인 불가" : a1 ? "회피" : "해당없음", a1, ecoOK ? "1등급 " + (a1 || 0).toLocaleString() + "㎡ (조회 결과에 폴리곤이 없는 곳은 1·2등급·별도관리지역 밖, 곧 3등급으로 봄)" : "생태자연도 조회 실패: " + D.eco.err, "지침 입지회피 4", "국립생태원 생태자연도(WFS) 조회 시점 기준");
    // e) 생태자연도 2등급 + 식생 Ⅲ 이상
    function A(fn) { return sum(fn); }
    var a2 = ecoOK ? A(function (c) { return c.e === "2"; }) : null,
      eY = ecoOK ? A(function (c) { return c.e === "2" && c.vg.ge3 === true; }) : null,
      eN = ecoOK ? A(function (c) { return c.e === "2" && c.vg.ge3 === false; }) : null,
      eU = ecoOK ? A(function (c) { return c.e === "2" && c.vg.ge3 === null; }) : null;
    var eEst = ecoOK ? A(function (c) { return c.e === "2" && c.vg.est; }) : 0;
    // 2등급 구간 군락 구성(면적 큰 순)
    var cl = {}; D.cells.forEach(function (c) { if (c.e === "2" && c.pn) cl[c.pn] = (cl[c.pn] || 0) + P[c.p].cellA; });
    var clT = Object.keys(cl).sort(function (x, y) { return cl[y] - cl[x]; }).slice(0, 4).map(function (k) { return k + " " + Math.round(cl[k]).toLocaleString() + "㎡"; }).join(", ");
    var hasV = D.eco.attrs;
    V(G, "e", "생태·자연도 2등급이면서 식생보전등급 Ⅲ등급 이상", !ecoOK ? "확인 불가" : !a2 ? "해당없음" : eY ? (eEst ? "회피(추정)" : "회피") : eU ? "수동확인필요" : (eEst ? "해당없음(추정)" : "해당없음"), ecoOK ? (eY || eU || 0) : null,
      ecoOK ? "2등급 " + (a2 || 0).toLocaleString() + "㎡ 중 식생 Ⅲ 이상 " + (eY || 0).toLocaleString() + "㎡, Ⅳ " + (eN || 0).toLocaleString() + "㎡" + (eU ? ", 미확정 " + eU.toLocaleString() + "㎡(Ⅲ인지 Ⅳ인지 입력 필요)" : "") + (eEst ? ". [추정] 그중 " + eEst.toLocaleString() + "㎡는 군락명으로 나눔(식재림 → Ⅳ, 자연림 군락 → Ⅲ) — 에코뱅크 '등급 지정 사유'의 식생보전등급으로 확인하거나 위에서 직접 고르면 바뀜" : "") +
        (hasV ? ". 생태자연도 식생 평가 2등급은 식생보전 Ⅲ 또는 Ⅳ라 둘을 구분하지 못함" : ". 생태자연도 식생 평가값을 받지 못해 입력값으로만 판정(Apps Script 갱신 필요)") + (clT ? " / 군락: " + clT + " [참고: 식재림은 보통 Ⅳ, 자연림은 Ⅲ 이상일 수 있음 — 추정]" : "") : "생태자연도 조회 실패",
      "지침 입지회피 5", "국립생태원 생태자연도(식생 평가) + 사용자 입력");
    // f) 경사 15° 이상 + 식생 Ⅳ 이상
    var fS = demOK ? A(function (c) { return c.s !== null && c.s >= S.avoid; }) : null,
      fY = demOK ? A(function (c) { return c.s !== null && c.s >= S.avoid && c.vg.ge4 === true; }) : null,
      fU = demOK ? A(function (c) { return c.s !== null && c.s >= S.avoid && c.vg.ge4 === null; }) : null,
      fE = demOK ? A(function (c) { return c.s !== null && c.s >= S.avoid && c.vg.src === "eco" && c.vg.ge4 !== null; }) : null,
      fUse = demOK ? A(function (c) { return c.s !== null && c.s >= S.avoid && c.vg.src === "use"; }) : 0;
    V(G, "f", "경사도 15° 이상이면서 식생보전등급 Ⅳ등급 이상", !demOK ? "확인 불가" : fY ? (fUse ? "회피(일부 추정)" : "회피") : fU ? "수동확인필요" : "해당없음", demOK ? (fY || fU || 0) : null,
      demOK ? "경사 15° 이상 " + fS.toLocaleString() + "㎡ 중 식생 Ⅳ 이상 " + fY.toLocaleString() + "㎡" + (fU ? ", 식생 미입력 " + fU.toLocaleString() + "㎡" : "") + (fE ? " (그중 " + fE.toLocaleString() + "㎡는 생태자연도 식생 평가값으로 판단)" : "") + (fUse ? ". [추정] " + fUse.toLocaleString() + "㎡는 토지특성 이용상황(" + uniq(P.map(function (p) { return p.lc && p.lc.use; })).join("·") + ")으로 식생을 추정 — 위에서 직접 고르면 바뀜" : "") + ". " + slopeNote() : "경사 자료 조회 실패: " + (D.fsErr || D.demErr),
      "지침 입지회피 6(경사 산정은 산지관리법 준용)", slopeSrc() + " + 식생 평가");
    // g) 지형변화지수 [추정]: 회피 구간을 뺀 곳을 약 30m 블록(어레이 몇 열 크기)마다 한 평면으로 정지한다고 가정 → (절토+성토)/면적
    function planeVol(cs) { var n0 = 0, sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
      cs.forEach(function (c) { var w = P[c.p].cellA; n0 += w; sx += w * c.mx; sy += w * c.my; sz += w * c.el; sxx += w * c.mx * c.mx; syy += w * c.my * c.my; sxy += w * c.mx * c.my; sxz += w * c.mx * c.el; syz += w * c.my * c.el; });
      function det(m) { return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]); }
      var M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n0]], V3 = [sxz, syz, sz], dt = det(M), v = 0;
      if (Math.abs(dt) < 1e-6) { var mz = sz / n0; cs.forEach(function (c) { v += Math.abs(c.el - mz) * P[c.p].cellA; }); return v; }
      var co = [0, 1, 2].map(function (k) { return det(M.map(function (r, i) { return r.map(function (x, j) { return j === k ? V3[i] : x; }); })) / dt; });
      cs.forEach(function (c) { v += Math.abs(c.el - (co[0] * c.mx + co[1] * c.my + co[2])) * P[c.p].cellA; }); return v; }
    var gz = D.cells.filter(function (c) { return c.st !== 2 && c.el !== null && c.el !== undefined; }), gIdx = null, gAll = null, gA = 0;
    if (gz.length >= 10) { gz.forEach(function (c) { gA += P[c.p].cellA; }); gAll = planeVol(gz) / gA;
      var blk = {}; gz.forEach(function (c) { var k = Math.floor(c.mx / 30) + ":" + Math.floor(c.my / 30); (blk[k] = blk[k] || []).push(c); });
      var vb = 0; Object.keys(blk).forEach(function (k) { vb += blk[k].length >= 3 ? planeVol(blk[k]) : 0; }); gIdx = vb / gA; }
    V(G, "g", "지형변화지수 1.5 이상 예상 지역 (절토+성토 ㎥ ÷ 사업면적 ㎡)", gIdx === null ? "수동확인필요" : gIdx >= 1.5 ? "수동확인필요" : "해당없음(추정)", null,
      gIdx === null ? "표고 자료가 부족해 계산 못 함" : "[추정] 회피 구간을 뺀 " + Math.round(gA).toLocaleString() + "㎡를 약 30m 블록마다 평면으로 정지(계단식)하면 지수 약 " + gIdx.toFixed(2) + (gIdx >= 1.5 ? " — 1.5 이상" : " — 1.5 미만") + " / 전체를 한 평면으로 깎으면 약 " + gAll.toFixed(2) + ". 공개 표고(약 30m)라 작은 요철은 빠짐. 확정은 토공 설계로",
      "지침 입지회피 7", "공개 표고(약 30m) 기반 추정");
    // h) 경관보전
    var hh = legalHits("h");
    V(G, "h", "생태·경관보전지역, 문화재보호구역 등 경관보전이 필요한 지역", hh.length ? "회피" : nedErr.length === P.length ? "확인 불가" : "해당없음", hh.length ? hitArea(hh) : null, hh.length ? hitText(hh) : "토지이용계획에 해당 지역·지구 없음" + nedNote, "지침 입지회피 8", luSrc);
    // i) 산사태위험
    var san = P.map(function (p, i) { return i; }).filter(function (i) { return P[i].jcode === "임"; }), hzOK = D.cells.some(function (c) { return c.hz !== undefined; });
    var h12 = hzOK ? A(function (c) { return san.indexOf(c.p) >= 0 && c.hz !== null && c.hz <= 2; }) : null, h12all = hzOK ? A(function (c) { return c.hz !== null && c.hz <= 2; }) : null;
    var hzB = {}; if (hzOK) D.cells.forEach(function (c) { if (san.indexOf(c.p) >= 0 && c.hz) hzB[c.hz] = (hzB[c.hz] || 0) + P[c.p].cellA; });
    V(G, "i", "산사태위험 1·2등급지 (사업지구가 산지인 경우)", !san.length ? "해당없음" : !hzOK ? "수동확인필요" : h12 ? "회피" : "해당없음", san.length ? (hzOK ? h12 : null) : null,
      !san.length ? "지목 임야 필지 없음(지목 기준)" + (h12all ? " — 다만 위험지도 1·2등급 " + h12all.toLocaleString() + "㎡ 있음(산지 아닌 필지)" : "")
        : hzOK ? "산지(지목 임야 " + san.map(function (i) { return P[i].jibun; }).join(", ") + ") 위험등급 면적: " + [1, 2, 3, 4, 5].filter(function (g) { return hzB[g]; }).map(function (g) { return g + "등급 " + Math.round(hzB[g]).toLocaleString() + "㎡"; }).join(", ") + (Object.keys(hzB).length ? "" : "위험지도 값 없음") + ". 10m 격자 값이라 경계부는 ±10m 오차"
        : "산림청 격자 조회 실패" + (D.fsErr ? "(" + D.fsErr + ")" : "") + " — 산사태정보시스템 위험지도로 확인",
      "지침 입지회피 9", "산림청 산사태위험지도(2025) 10m 격자");

    // 신중검토
    var c1 = ecoOK && demOK ? A(function (c) { return c.st === 1 && c.e === "2"; }) : null, c1U = ecoOK && demOK ? A(function (c) { return c.e === "2" && c.vg.ge3 === null && c.s !== null && c.s < S.avoid; }) : null;
    V(G2, "k1", "생태·자연도 2등급(식생보전 Ⅳ등급)이면서 경사도 15° 미만", !ecoOK ? "확인 불가" : c1 ? "신중검토" : c1U ? "수동확인필요" : "해당없음", ecoOK ? (c1 || c1U || 0) : null,
      (c1 ? "식생 Ⅳ·경사 15° 미만 " + c1.toLocaleString() + "㎡" : "") + (c1U ? (c1 ? ", " : "") + "식생 미확정 " + c1U.toLocaleString() + "㎡(Ⅳ이면 신중검토, Ⅲ 이상이면 회피)" : "") || "해당 구간 없음", "지침 신중검토 1", "생태자연도 + 표고[추정]");
    var crops = P.map(function (p, i) { return i; }).filter(function (i) { return /^(전|답|과)$/.test(P[i].jcode); });
    var c2 = demOK ? sum(function (c) { return crops.indexOf(c.p) >= 0 && D.forestNb[c.p] && c.s !== null && c.s >= S.crop; }) : null;
    V(G2, "k2", "산림으로 둘러싸이거나 산림 경계와 연접한 경작지로 경사도 20° 이상", !crops.length ? "해당없음" : !demOK ? "확인 불가" : c2 ? "신중검토" : "해당없음", c2,
      crops.length ? "경작지(전·답·과) " + crops.map(function (i) { return P[i].jibun + (D.forestNb[i] ? "(산림 연접)" : ""); }).join(", ") + (demOK ? " — 20° 이상 " + (c2 || 0).toLocaleString() + "㎡ [추정]" : "") : "지목 전·답·과 필지 없음", "지침 신중검토", "지목·인접 필지 지목 + 표고[추정]");
    V(G2, "k3", "동물 이동로·생태축, 양호한 산림 내부 100m 이상 진입로, 보호지역 1km 이내 등 나머지 항목", "수동확인필요", null, "공개 데이터로 자동 판정 불가 — 현장·도면 검토", "지침 신중검토 나머지", "-");

    // 인허가
    var zA = {}; D.cells.forEach(function (c) { var k = c.z || "(용도지역 없음)"; zA[k] = (zA[k] || 0) + P[c.p].cellA; });
    var ratio = 0, zt = []; Object.keys(zA).forEach(function (k) { var a = Math.round(zA[k]); zt.push(k + " " + a.toLocaleString() + "㎡"); var th = R.seia.zones[k]; if (th) ratio += a / th; });
    var urb = Object.keys(zA).some(function (k) { return /주거|상업|공업|보전녹지/.test(k); });
    V(G3, "s1", "소규모 환경영향평가 대상 여부", urb ? "수동확인필요" : ratio >= 1 ? "대상" : "대상 아님(면적 기준)", Math.round(area(P)),
      zt.join(", ") + (urb ? " — 도시지역 포함: 별표4 다른 기준 적용, 수동 확인" : " → 면적÷기준면적 합 " + ratio.toFixed(2) + (ratio >= 1 ? " (1 이상)" : " (1 미만)")) + ". 사업면적을 줄이면 달라짐. 용도지역 경계는 지적과 다를 수 있어 토지이음으로 확인",
      R.seia.law + " — " + R.seia.status, "브이월드 용도지역 레이어(고시연도 " + uniq(D.zones.map(function (z) { return z.y; }).filter(function (y) { return y && y !== "0000"; })).join("/") + ")");
    var rdOK = D.roads.filter(function (r) { return r.touch.some(function (t) { return t.L >= 2; }); }), rd = rdOK.length;
    var lcT = P.map(function (p) { return p.lc && p.lc.road ? p.jibun + " " + p.lc.road + (p.lc.year ? "(" + p.lc.year + "년 조사)" : "") : null; }).filter(Boolean);
    var lcBlind = P.some(function (p) { return p.lc && /맹지/.test(p.lc.road || ""); }), lcAll = P.every(function (p) { return p.lc && /맹지/.test(p.lc.road || ""); });
    var lcRoad = P.filter(function (p) { return p.lc && p.lc.road && !/맹지/.test(p.lc.road); });
    V(G3, "s2", "진입로(지적상 도로 접함 / 토지특성 도로접면)", rd ? (lcAll ? "수동확인필요" : "확인됨") : lcRoad.length ? "확인됨(현황도로)" : "맹지 의심", null, (lcT.length ? "토지특성 도로접면: " + lcT.join(", ") + (rd && lcAll ? " — 지적도에는 도로 필지가 붙어 있으나 공시지가 조사에서는 맹지로 봄(도로 미개설·통행 불가 등 현황 차이 가능)" : "") + ". " : "") + (rd ? "지적도상 맞닿은 도로: " + rdOK.map(function (r) { return r.jibun + "(" + r.touch.map(function (t) { return P[t.i].jibun + " 약 " + Math.round(t.L) + "m"; }).join("·") + ")"; }).join(", ") + " — 도로 소유(국공유·사유), 실제 통행 가능 여부·폭은 현장·토지대장으로 확인" : "사업지 필지에 맞닿은 지목 '도로' 필지가 없음" + (D.roads.length ? "(모서리만 닿는 도로: " + D.roads.map(function (r) { return r.jibun; }).join(", ") + ")" : "") + " — 현황도로·사용승낙으로 진입 가능한지 확인"), "개발행위허가 기준(진입로)", "연속지적도");
    var hn = D.houses.filter(function (h) { return h.d <= R.houses.near; }).length, hf = D.houses.length, BU = D.bldUse && !D.bldUse._err;
    function isHome(h) { return (h.use || []).some(function (u) { return /주택|아파트|연립|다세대|다가구|기숙사/.test(u); }); }
    function byLot(arr) { var m = {}; arr.forEach(function (h) { var k = h.pnu || h.name; if (!m[k] || h.d < m[k].d) m[k] = h; }); return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return a.d - b.d; }); }
    var hh2 = BU ? byLot(D.houses.filter(isHome)) : [], hhN = hh2.filter(function (h) { return h.d <= R.houses.near; }).length, unk = BU ? D.houses.filter(function (h) { return !h.use || !h.use.length; }).length : 0;
    V(G3, "s3", "주변 주택(이격) — " + R.houses.near + "m / " + R.houses.far + "m 안", BU ? (hh2.length >= R.houses.n ? "수동확인필요" : "참고") : hf >= R.houses.n ? "수동확인필요" : "참고", null,
      BU ? "건축물대장 주용도 기준 주택(지번 단위) " + R.houses.near + "m 안 " + hhN + "동, " + R.houses.far + "m 안 " + hh2.length + "동 (전체 건물 " + hf + "동, 대장 없음 " + unk + "동)" + (hh2.length >= R.houses.n ? " — " + R.houses.n + "호 이상: 조례·체크리스트 이격 기준과 대조" : "") + (hh2.length ? ". 가까운 주택: " + hh2.slice(0, 5).map(function (h) { return h.name.trim() + " " + h.d + "m"; }).join(", ") : "")
        : R.houses.near + "m 안 " + hn + "동, " + R.houses.far + "m 안 " + hf + "동(도로명주소가 붙은 건물, 사업지 안 제외). 주택 여부 미구분" + (D.bldUse && D.bldUse._err ? " — 건축물대장 조회 실패: " + String(D.bldUse._err).slice(0, 80) + " (공공데이터포털에서 '국토교통부_건축HUB_건축물대장정보 서비스' 활용신청 필요할 수 있음)" : " — Apps Script를 새 코드로 배포하면 건축물대장 주용도로 주택만 셈"),
      R.houses.src, BU ? "건축물대장 표제부(건축HUB) + 도로명주소 건물" : "브이월드 도로명주소 건물");
    var SB = R.setback, rule = SB.sgg[D.sgg] || null, Dist = rule ? rule.house : SB.cap, NN = rule ? rule.n : SB.n;
    var hl = (BU ? byLot(D.houses.filter(isHome)) : byLot(D.houses)).map(function (h) { return h.d; }).sort(function (a, b) { return a - b; }), d5 = hl.length >= NN ? hl[NN - 1] : null;
    V(G3, "s4", "주거지 이격거리(법 상한 · 시군 조례)", d5 === null ? "해당없음" : d5 < Dist ? (rule ? "회피" : "수동확인필요") : "해당없음", null,
      (rule ? rule.name + " 조례: 주거지(주택 " + rule.n + "호 이상) " + rule.house + "m, 도로 " + (rule.road ? rule.road + "m" : "이격 없음") + " (" + rule.src + ")" : "이 시군 조례 수치는 아직 등록 안 됨 → 법 상한 " + SB.cap + "m(주택 " + SB.n + "호 이상)로 판정") + ". " +
        (BU ? "주택" : "건물(주택 여부 미구분)") + " " + NN + "번째로 가까운 곳 " + (d5 === null ? R.houses.far + "m 밖" : d5 + "m") + (d5 !== null && d5 < Dist ? " → " + Dist + "m 안에 " + NN + "호 이상" : "") + ". 도로 이격은 법 개정으로 적용 안 함. '5호 이상 주거지'의 범위 산정 방식은 조례마다 달라 근사치",
      SB.law, BU ? "건축물대장 주용도" : "도로명주소 건물");
    var info = []; Object.keys(ned).forEach(function (k) { if (R.info.test(k)) info.push(k + "(" + uniq(ned[k].map(function (y) { return P[y.i].jibun; })).join(", ") + ")"); });
    V(G3, "s5", "그 밖의 지역·지구(보전산지·농업진흥구역·가축사육제한구역 등)", info.length ? "참고" : "해당없음", null, info.length ? info.join(" · ") : "해당 지역·지구 없음" + nedNote, "토지이용계획", luSrc);

    // 필지별 표
    var per = P.map(function (p, i) { var C = D.cells.filter(function (c) { return c.p === i; }), A = p.cellA;
      function s(fn) { return Math.round(C.filter(fn).length * A); }
      return { jibun: p.jibun, jimok: p.jimok, area: Math.round(p.area), e1: s(function (c) { return c.e === "1"; }), e2: s(function (c) { return c.e === "2"; }), e3: s(function (c) { return !c.e || c.e === "3"; }), e0: s(function (c) { return c.e === "9"; }),
        s15: s(function (c) { return c.s !== null && c.s >= S.avoid; }), av: s(function (c) { return c.st === 2; }), cau: s(function (c) { return c.st === 1; }), unk: s(function (c) { return c.st === 3; }), forest: !!D.forestNb[i] }; });
    var tot = { av: per.reduce(function (a, r) { return a + r.av; }, 0), cau: per.reduce(function (a, r) { return a + r.cau; }, 0), unk: per.reduce(function (a, r) { return a + r.unk; }, 0), area: Math.round(area(P)) };
    tot.ok = tot.area - tot.av - tot.cau - tot.unk;
    return { rows: rows, per: per, tot: tot };
  }
  function uniqA(a) { var s = {}; return a.filter(function (x) { if (!x || s[x]) return false; s[x] = 1; return true; }); }
  function area(P) { return P.reduce(function (s, p) { return s + p.area; }, 0); }
  function uniq(a) { var s = {}; return a.filter(function (x) { if (!x || s[x]) return false; s[x] = 1; return true; }); }

  window.Screen = { run: run, judge: judge, parseInput: parseInput, tm5186: tm5186 };
})();
