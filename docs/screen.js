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
      return { f: j.f.map(function (f) { return { g: String(f[0]), rs: f[1].map(function (r) { return { r: r, b: bbox(r) }; }) }; }) };
    }).catch(function (e) { clearTimeout(tm); return { err: e.name === "AbortError" ? "시간 초과(30초)" : e.message }; });
  }

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
    var ecoP = ecoFetch(Breal);
    var demP = demPrep(pad(Breal, 40)).then(function () { return null; }).catch(function (e) { return e.message; });
    var nbP = allFeatures("LP_PA_CBND_BUBUN", pad(B, 25), 2);
    var bldP = allFeatures("LT_C_SPBD", pad(Breal, R.houses.far + 20), 3);
    var zr = await zoneP, ned = await nedP, eco = await ecoP, demErr = await demP, nb = await nbP, bld = await bldP;

    var zones = []; zr.forEach(function (fs) { fs.forEach(function (f) { var pr = f.properties || {}; polys(f.geometry).forEach(function (r) { zones.push({ n: pr.uname || "?", y: pr.dyear || "", r: r, b: bbox(r) }); }); }); });
    P.forEach(function (p, i) { p.ned = ned[i]; });

    prog("필지 안을 격자로 나눠 계산하고 있습니다", 70);
    var area = 0; P.forEach(function (p) { area += p.area; });
    var step = Math.max(2, Math.sqrt(area / 9000)), dlon = step / kx, dlat = step / ky, H = 5;
    var nx = Math.ceil((B[2] - B[0]) / dlon), ny = Math.ceil((B[3] - B[1]) / dlat), cells = [];
    for (var ix = 0; ix < nx; ix++) for (var iy = 0; iy < ny; iy++) {
      var q = [B[0] + (ix + 0.5) * dlon, B[1] + (iy + 0.5) * dlat], pi = -1;
      for (var k = 0; k < P.length && pi < 0; k++) if (P[k].rings.some(function (o) { return inB(q, o.b) && pip(q, o.r); })) pi = k;
      if (pi < 0) continue;
      var zn = null; for (var z = 0; z < zones.length; z++) if (inB(q, zones[z].b) && pip(q, zones[z].r)) { zn = zones[z].n; break; }
      var rl = [q[0] + dx, q[1] + dy], eg = null;
      if (eco.f) { var t = tm5186(rl[0], rl[1]); for (var e = 0; e < eco.f.length && !eg; e++) if (eco.f[e].rs.some(function (o) { return inB(t, o.b) && pip(t, o.r); })) eg = eco.f[e].g; }
      var sl = null;
      if (!demErr) { var gx = (elev(rl[0] + H / kx, rl[1]) - elev(rl[0] - H / kx, rl[1])) / (2 * H), gy = (elev(rl[0], rl[1] + H / ky) - elev(rl[0], rl[1] - H / ky)) / (2 * H); if (isFinite(gx) && isFinite(gy)) sl = Math.atan(Math.hypot(gx, gy)) * 180 / Math.PI; }
      cells.push({ ix: ix, iy: iy, p: pi, z: zn, e: eg, s: sl });
    }
    // 칸 면적: 필지마다 실제 면적에 맞춤
    P.forEach(function (p, i) { var n = cells.filter(function (c) { return c.p === i; }).length; p.cellA = n ? p.area / n : 0; p.n = n; });

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

    // 주변 건물(도로명주소 건물) — 실제 위치 기준, 사업지 안 건물 제외
    var realRings = []; P.forEach(function (p) { p.rings.forEach(function (o) { realRings.push(o.r.map(function (v) { return [v[0] + dx, v[1] + dy]; })); }); });
    var houses = [];
    bld.forEach(function (f) { var pr = f.properties || {}, sn = String(pr.bd_mgt_sn || "").slice(0, 19); var r0 = polys(f.geometry)[0]; if (!r0) return; var cx = 0, cy = 0; r0.forEach(function (v) { cx += v[0]; cy += v[1]; }); cx /= r0.length; cy /= r0.length;
      if (mine[sn]) return; var inside = realRings.some(function (r) { return pip([cx, cy], r); }); if (inside) return;
      var d = Infinity; r0.forEach(function (v) { realRings.forEach(function (r) { var dd = ringDist(v, r, kx, ky); if (dd < d) d = dd; }); });
      if (d <= R.houses.far) houses.push({ d: Math.round(d), name: (pr.rd_nm || "") + " " + (pr.buld_no || "") + (pr.buld_nm ? " " + pr.buld_nm : ""), pnu: sn, c: [cy, cx] }); });
    houses.sort(function (a, b) { return a.d - b.d; });

    prog("판정하고 있습니다", 95);
    return { at: new Date(), P: P, miss: miss, B: B, step: step, dlon: dlon, dlat: dlat, nx: nx, ny: ny, cells: cells, shift: SH, kx: kx, ky: ky,
      eco: eco.err ? { err: eco.err } : { ok: true, n: eco.f.length }, demErr: demErr, zones: zones, roads: roads, forestNb: forestNb, houses: houses };
  }

  /* ── 판정: 식생보전등급 입력(veg2: 2등급 구간, vegP[i]: 필지별 그 밖의 구간)에 따라 다시 계산 ──
     식생 값: "3+" = Ⅲ등급 이상, "4" = Ⅳ등급, "4+" = Ⅳ등급 이상, "5" = Ⅴ등급 이하(농경지 등), "" = 모름 */
  function judge(D, veg2, vegP) {
    var S = R.slope, rows = [], P = D.P, sum = function (fn) { var a = 0; D.cells.forEach(function (c) { if (fn(c)) a += P[c.p].cellA; }); return Math.round(a); };
    function vegOf(c) { if (c.e === "2") return veg2 === "3+" ? "3+" : veg2 === "4" ? "4" : ""; return vegP[c.p] || ""; }
    function ge4(v) { return v === "3+" || v === "4" || v === "4+"; }
    var ecoOK = !D.eco.err, demOK = !D.demErr;
    // 칸별 상태: 2 = 회피, 1 = 신중, 3 = 식생 확인 시 회피 가능, 0 = 해당 없음
    D.cells.forEach(function (c) { var v = vegOf(c), st = 0;
      if (c.e === "1") st = 2;
      else if (c.e === "2" && v === "3+") st = 2;
      else if (c.s !== null && c.s >= S.avoid && ge4(v)) st = 2;
      else if (c.e === "2" && !v) st = 3;
      else if (c.s !== null && c.s >= S.avoid && !v) st = 3;
      else if (c.e === "2" && v === "4" && c.s !== null && c.s < S.avoid) st = 1;
      else if (/^(전|답|과)$/.test(P[c.p].jcode) && D.forestNb[c.p] && c.s !== null && c.s >= S.crop) st = 1;
      c.st = st; });

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
    var ha = legalHits("a");
    V(G, "a", "백두대간·정맥 보호지역, 주요 산줄기 능선축(기맥 좌우 100m, 지맥 50m)", ha.length ? "회피" : "수동확인필요", ha.length ? hitArea(ha) : null,
      ha.length ? hitText(ha) : "백두대간보호지역은 토지이용계획상 없음" + nedNote + ". 정맥·기맥·지맥 능선축과의 거리는 공개 데이터가 없어 판정하지 않음 — 산림청 산줄기 지도로 확인",
      "지침 입지회피 1", luSrc);
    // b) 법정보호지역
    var hb = legalHits("b"), e9 = ecoOK ? sum(function (c) { return c.e === "9"; }) : 0;
    V(G, "b", "생태·경관보전지역, 야생생물보호구역, 습지보호지역, 상수원보호구역 등 법정보호지역", hb.length ? "회피" : nedErr.length === P.length ? "확인 불가" : e9 ? "수동확인필요" : "해당없음", hb.length ? hitArea(hb) : (e9 || null),
      (hb.length ? hitText(hb) : "토지이용계획에 해당 지역·지구 없음" + nedNote) + (e9 ? " / 생태자연도 '별도관리지역' " + e9.toLocaleString() + "㎡ — 지정 사유(법정보호지역 여부) 확인" : ""),
      "지침 입지회피 2", luSrc);
    // c) 법정보호종
    V(G, "c", "멸종위기 야생생물·천연기념물 등 법정보호종 서식지·산란처·철새도래지", "수동확인필요", null, "공개 위치 데이터 없음 — 현지조사·국립생태원 자료로 확인", "지침 입지회피 3", "-");
    // d) 생태자연도 1등급
    var a1 = ecoOK ? sum(function (c) { return c.e === "1"; }) : null;
    V(G, "d", "생태·자연도 1등급(식생보전 Ⅰ-Ⅱ등급 / 비오톱 Ⅰ-Ⅱ등급)", !ecoOK ? "확인 불가" : a1 ? "회피" : "해당없음", a1, ecoOK ? "1등급 " + (a1 || 0).toLocaleString() + "㎡ (조회 결과에 폴리곤이 없는 곳은 1·2등급·별도관리지역 밖, 곧 3등급으로 봄)" : "생태자연도 조회 실패: " + D.eco.err, "지침 입지회피 4", "국립생태원 생태자연도(WFS) 조회 시점 기준");
    // e) 생태자연도 2등급 + 식생 Ⅲ 이상
    var a2 = ecoOK ? sum(function (c) { return c.e === "2"; }) : null;
    V(G, "e", "생태·자연도 2등급이면서 식생보전등급 Ⅲ등급 이상", !ecoOK ? "확인 불가" : !a2 ? "해당없음" : veg2 === "3+" ? "회피" : veg2 === "4" ? "해당없음" : "수동확인필요", a2,
      ecoOK ? "2등급 " + (a2 || 0).toLocaleString() + "㎡ — " + (veg2 === "3+" ? "식생 Ⅲ 이상으로 입력 → 회피" : veg2 === "4" ? "식생 Ⅳ로 입력 → 회피 아님(신중검토 항목으로)" : a2 ? "식생보전등급을 입력하면 판정(Ⅲ 이상이면 이 면적 회피)" : "") : "생태자연도 조회 실패",
      "지침 입지회피 5", "국립생태원 생태자연도 + 식생보전등급(사용자 입력)");
    // f) 경사 15° 이상 + 식생 Ⅳ 이상
    var fS = demOK ? sum(function (c) { return c.s !== null && c.s >= S.avoid; }) : null,
      fY = demOK ? sum(function (c) { return c.s !== null && c.s >= S.avoid && ge4(vegOf(c)); }) : null,
      fU = demOK ? sum(function (c) { return c.s !== null && c.s >= S.avoid && !vegOf(c); }) : null;
    V(G, "f", "경사도 15° 이상이면서 식생보전등급 Ⅳ등급 이상", !demOK ? "확인 불가" : fY ? "회피" : fU ? "수동확인필요" : "해당없음", demOK ? (fY || fU || 0) : null,
      demOK ? "경사 15° 이상 " + fS.toLocaleString() + "㎡ 중 식생 Ⅳ 이상 " + fY.toLocaleString() + "㎡" + (fU ? ", 식생 미입력 " + fU.toLocaleString() + "㎡" : "") + ". [추정] 표고 약 30m 해상도라 실제(산지관리법 방식 10m 격자)보다 작게 나옴 — 서산 명천리 검증에서 보고서 7,036㎡ 대비 약 25% 적었음. 산지정보시스템 경사 분석으로 확정" : "표고 자료 조회 실패: " + D.demErr,
      "지침 입지회피 6(경사 산정은 산지관리법 준용)", "Mapzen Terrarium 표고(SRTM 기반)");
    // g) 지형변화지수
    V(G, "g", "지형변화지수 1.5 이상 예상 지역 (절토+성토 ㎥ ÷ 사업면적 ㎡)", "수동확인필요", null, "토공 설계(절·성토량)가 있어야 계산 가능", "지침 입지회피 7", "-");
    // h) 경관보전
    var hh = legalHits("h");
    V(G, "h", "생태·경관보전지역, 문화재보호구역 등 경관보전이 필요한 지역", hh.length ? "회피" : nedErr.length === P.length ? "확인 불가" : "해당없음", hh.length ? hitArea(hh) : null, hh.length ? hitText(hh) : "토지이용계획에 해당 지역·지구 없음" + nedNote, "지침 입지회피 8", luSrc);
    // i) 산사태위험
    var san = P.filter(function (p) { return p.jcode === "임"; });
    V(G, "i", "산사태위험 1·2등급지 (사업지구가 산지인 경우)", san.length ? "수동확인필요" : "해당없음", san.length ? Math.round(san.reduce(function (s, p) { return s + p.area; }, 0)) : null,
      san.length ? "산지(지목 임야): " + san.map(function (p) { return p.jibun; }).join(", ") + " — 산사태정보시스템 위험지도로 1·2등급 여부 확인" : "지목 임야 필지 없음(지목 기준)", "지침 입지회피 9", "지목(지적도)");

    // 신중검토
    var c1 = ecoOK && demOK ? sum(function (c) { return c.e === "2" && c.s !== null && c.s < S.avoid; }) : null;
    V(G2, "k1", "생태·자연도 2등급(식생보전 Ⅳ등급)이면서 경사도 15° 미만", !ecoOK ? "확인 불가" : !c1 ? "해당없음" : veg2 === "4" ? "신중검토" : veg2 === "3+" ? "해당없음" : "수동확인필요", c1,
      c1 ? "2등급 중 경사 15° 미만 " + c1.toLocaleString() + "㎡ — " + (veg2 === "4" ? "식생 Ⅳ로 입력 → 신중검토" : veg2 === "3+" ? "식생 Ⅲ 이상 → 회피 항목(e)으로" : "식생 Ⅳ이면 신중검토") : "해당 구간 없음", "지침 신중검토 1", "생태자연도 + 표고[추정]");
    var crops = P.map(function (p, i) { return i; }).filter(function (i) { return /^(전|답|과)$/.test(P[i].jcode); });
    var c2 = demOK ? sum(function (c) { return crops.indexOf(c.p) >= 0 && D.forestNb[c.p] && c.s !== null && c.s >= S.crop; }) : null;
    V(G2, "k2", "산림으로 둘러싸이거나 산림 경계와 연접한 경작지로 경사도 20° 이상", !crops.length ? "해당없음" : !demOK ? "확인 불가" : c2 ? "신중검토" : "해당없음", c2,
      crops.length ? "경작지(전·답·과) " + crops.map(function (i) { return P[i].jibun + (D.forestNb[i] ? "(산림 연접)" : ""); }).join(", ") + (demOK ? " — 20° 이상 " + (c2 || 0).toLocaleString() + "㎡ [추정]" : "") : "지목 전·답·과 필지 없음", "지침 신중검토", "지목·인접 필지 지목 + 표고[추정]");
    V(G2, "k3", "동물 이동로·생태축, 양호한 산림 내부 100m 이상 진입로, 보호지역 1km 이내 등 나머지 항목", "수동확인필요", null, "공개 데이터로 자동 판정 불가 — 현장·도면 검토", "지침 신중검토 나머지", "-");

    // 인허가
    var zA = {}; D.cells.forEach(function (c) { var k = c.z || "(용도지역 없음)"; zA[k] = (zA[k] || 0) + P[c.p].cellA; });
    var ratio = 0, zt = []; Object.keys(zA).forEach(function (k) { var a = Math.round(zA[k]); zt.push(k + " " + a.toLocaleString() + "㎡"); var th = R.seia.zones[k]; if (th) ratio += a / th; });
    var urb = Object.keys(zA).some(function (k) { return /주거|상업|공업|녹지/.test(k); });
    V(G3, "s1", "소규모 환경영향평가 대상 여부", urb ? "수동확인필요" : ratio >= 1 ? "대상" : "대상 아님(면적 기준)", Math.round(area(P)),
      zt.join(", ") + (urb ? " — 도시지역 포함: 별표4 다른 기준 적용, 수동 확인" : " → 면적÷기준면적 합 " + ratio.toFixed(2) + (ratio >= 1 ? " (1 이상)" : " (1 미만)")) + ". 사업면적을 줄이면 달라짐. 용도지역 경계는 지적과 다를 수 있어 토지이음으로 확인",
      R.seia.law + " — " + R.seia.status, "브이월드 용도지역 레이어(고시연도 " + uniq(D.zones.map(function (z) { return z.y; }).filter(function (y) { return y && y !== "0000"; })).join("/") + ")");
    var rdOK = D.roads.filter(function (r) { return r.touch.some(function (t) { return t.L >= 2; }); }), rd = rdOK.length;
    V(G3, "s2", "진입로(지적상 도로 접함)", rd ? "확인됨" : "맹지 의심", null, (rd ? "지적도상 맞닿은 도로: " + rdOK.map(function (r) { return r.jibun + "(" + r.touch.map(function (t) { return P[t.i].jibun + " 약 " + Math.round(t.L) + "m"; }).join("·") + ")"; }).join(", ") + " — 도로 소유(국공유·사유), 실제 통행 가능 여부·폭은 현장·토지대장으로 확인" : "사업지 필지에 맞닿은 지목 '도로' 필지가 없음" + (D.roads.length ? "(모서리만 닿는 도로: " + D.roads.map(function (r) { return r.jibun; }).join(", ") + ")" : "") + " — 현황도로·사용승낙으로 진입 가능한지 확인"), "개발행위허가 기준(진입로)", "연속지적도");
    var hn = D.houses.filter(function (h) { return h.d <= R.houses.near; }).length, hf = D.houses.length;
    V(G3, "s3", "주변 건물(주택 이격) — " + R.houses.near + "m / " + R.houses.far + "m 안", hf >= R.houses.n ? "수동확인필요" : "참고", null,
      R.houses.near + "m 안 " + hn + "동, " + R.houses.far + "m 안 " + hf + "동(도로명주소가 붙은 건물, 사업지 안 제외). 주택인지 창고인지는 데이터가 비어 있어 미구분" + (hf >= R.houses.n ? " — " + R.houses.n + "동 이상이라 주택 여부·호수 확인" : ""),
      R.houses.src, "브이월드 도로명주소 건물");
    V(G3, "s4", "시·군 조례 이격거리(주거지·도로)", "수동확인필요", null, "시군별 도시계획 조례 별표 수치는 아직 넣지 않음 — 해당 시군 조례 원문 확인", "국토계획법 시행령 별표1의2 + 시군 도시계획 조례", "-");
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
  function area(P) { return P.reduce(function (s, p) { return s + p.area; }, 0); }
  function uniq(a) { var s = {}; return a.filter(function (x) { if (!x || s[x]) return false; s[x] = 1; return true; }); }

  window.Screen = { run: run, judge: judge, parseInput: parseInput, tm5186: tm5186 };
})();
