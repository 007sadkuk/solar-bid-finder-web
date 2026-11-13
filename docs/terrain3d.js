/* 3D 지형 보기: 표고(Screen.elev, Mapzen Terrarium) + 위성사진(브이월드) / 경사도 / 판정 색을 입혀 three.js로 보여줌.
   사용: Terrain3D.open({D, cellColor, key}) — D는 Screen.run 결과, cellColor(c, mode)는 판정 색 함수 */
(function () {
  var THREE = null, OC = null;
  function loadLibs() {
    if (THREE) return Promise.resolve();
    return Promise.all([import("https://cdn.jsdelivr.net/npm/three@0.160.0/+esm"), import("https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js/+esm")])
      .then(function (m) { THREE = m[0]; OC = m[1].OrbitControls; });
  }
  function mx(lon, z) { return (lon + 180) / 360 * 256 * Math.pow(2, z); }
  function my(lat, z) { var s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * Math.pow(2, z); }
  function satCanvas(B, key, W, H) { // B=[w,s,e,n] → W×H 캔버스에 위성 타일을 정확히 잘라 붙임
    var z = 18; while (z > 14 && (mx(B[2], z) - mx(B[0], z)) > 2600) z--;
    var x0 = mx(B[0], z), x1 = mx(B[2], z), y0 = my(B[3], z), y1 = my(B[1], z), c = document.createElement("canvas"); c.width = W; c.height = H;
    var g = c.getContext("2d"); g.fillStyle = "#555"; g.fillRect(0, 0, W, H); var sx = W / (x1 - x0), sy = H / (y1 - y0), ps = [];
    for (var tx = Math.floor(x0 / 256); tx <= Math.floor(x1 / 256); tx++) for (var ty = Math.floor(y0 / 256); ty <= Math.floor(y1 / 256); ty++) (function (tx, ty) {
      ps.push(new Promise(function (ok) { var im = new Image(); im.crossOrigin = "anonymous";
        im.onload = function () { g.drawImage(im, (tx * 256 - x0) * sx, (ty * 256 - y0) * sy, 256 * sx + 1, 256 * sy + 1); ok(); }; im.onerror = function () { ok(); };
        im.src = "https://api.vworld.kr/req/wmts/1.0.0/" + key + "/Satellite/" + z + "/" + ty + "/" + tx + ".jpeg"; })); })(tx, ty);
    return Promise.all(ps).then(function () { return c; });
  }
  var UI = null;
  function close() { if (!UI) return; cancelAnimationFrame(UI.raf); try { UI.renderer.dispose(); } catch (e) {} UI.root.remove(); window.removeEventListener("resize", UI.onRes); window.removeEventListener("keydown", UI.onKey); UI = null; }
  async function open(o) {
    var D = o.D, key = o.key; close();
    var root = document.createElement("div"); root.style.cssText = "position:fixed;inset:0;z-index:100000;background:#0d0f12;color:#fff;font:14px/1.5 'Pretendard Variable',Pretendard,system-ui,sans-serif";
    root.innerHTML = '<div style="position:absolute;left:12px;top:12px;right:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;z-index:2">'
      + '<b style="font-size:16px;margin-right:6px">3D 지형</b>'
      + '<span id="t3m" style="display:flex;gap:6px;flex-wrap:wrap"><button data-t="sat">위성사진</button><button data-t="slope">경사도</button><button data-t="st">설치 가능/신중/불가</button></span>'
      + '<label style="margin-left:6px">높이 과장 <select id="t3x"><option value="1">1배(실제)</option><option value="1.5">1.5배</option><option value="2" selected>2배</option><option value="3">3배</option></select></label>'
      + '<span style="flex:1"></span><button id="t3c">닫기 ✕</button></div>'
      + '<div id="t3lg" style="position:absolute;left:12px;bottom:12px;z-index:2;background:rgba(0,0,0,.6);padding:8px 12px;border-radius:10px;max-width:calc(100% - 24px)"></div>'
      + '<div id="t3msg" style="position:absolute;inset:0;display:grid;place-items:center;z-index:1">지형을 불러오는 중…</div>';
    document.body.appendChild(root);
    root.querySelectorAll("button").forEach(function (b) { b.style.cssText = "font:inherit;border:1px solid #555;background:#1b1e23;color:#fff;border-radius:999px;padding:6px 14px;cursor:pointer"; });
    UI = { root: root }; root.querySelector("#t3c").onclick = close;
    UI.onKey = function (e) { if (e.key === "Escape") close(); }; window.addEventListener("keydown", UI.onKey);
    try {
      await loadLibs();
      var sh = D.shift || { dx: 0, dy: 0 }, kx = D.kx, ky = 111132;
      var b = D.B, pad = 110, B = [b[0] + sh.dx - pad / kx, b[1] + sh.dy - pad / ky, b[0] + sh.dx + D.nx * D.dlon + pad / kx, b[1] + sh.dy + D.ny * D.dlat + pad / ky];
      var Wm = (B[2] - B[0]) * kx, Hm = (B[3] - B[1]) * ky;
      await Screen.demPrep([B[0] - sh.dx, B[1] - sh.dy, B[2] - sh.dx, B[3] - sh.dy]);
      var N = 180, nx = Wm >= Hm ? N : Math.max(40, Math.round(N * Wm / Hm)), ny = Hm > Wm ? N : Math.max(40, Math.round(N * Hm / Wm));
      var h = new Float32Array(nx * ny), mn = Infinity, mxh = -Infinity;
      for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) { var lon = B[0] + (B[2] - B[0]) * i / (nx - 1), lat = B[3] - (B[3] - B[1]) * j / (ny - 1);
        var v = Screen.elev(lon - sh.dx, lat - sh.dy); if (!isFinite(v)) v = NaN; h[j * nx + i] = v; if (isFinite(v)) { if (v < mn) mn = v; if (v > mxh) mxh = v; } }
      for (var q = 0; q < h.length; q++) if (!isFinite(h[q])) h[q] = mn;
      // 경사(도) 격자
      var dx = Wm / (nx - 1), dy = Hm / (ny - 1), sl = new Float32Array(nx * ny);
      for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) { var a = h[j * nx + Math.max(0, i - 1)], c2 = h[j * nx + Math.min(nx - 1, i + 1)], u = h[Math.max(0, j - 1) * nx + i], d2 = h[Math.min(ny - 1, j + 1) * nx + i];
        var gx = (c2 - a) / (dx * ((i > 0 && i < nx - 1) ? 2 : 1)), gy = (d2 - u) / (dy * ((j > 0 && j < ny - 1) ? 2 : 1)); sl[j * nx + i] = Math.atan(Math.sqrt(gx * gx + gy * gy)) * 180 / Math.PI; }
      var TW = 2048, TH = Math.round(TW * Hm / Wm); if (TH > 2048) { TH = 2048; TW = Math.round(2048 * Wm / Hm); }
      var sat = await satCanvas(B, key, TW, TH);
      function toPx(lon, lat) { return [(lon - B[0]) / (B[2] - B[0]) * TW, (B[3] - lat) / (B[3] - B[1]) * TH]; }
      function outline(g) { g.lineWidth = Math.max(2, TW / 500); g.strokeStyle = "#fff"; D.P.forEach(function (p) { p.rings.forEach(function (r) { g.beginPath(); r.r.forEach(function (v, k) { var P = toPx(v[0] + sh.dx, v[1] + sh.dy); k ? g.lineTo(P[0], P[1]) : g.moveTo(P[0], P[1]); }); g.closePath(); g.stroke(); }); }); }
      function slopeCol(s) { return s < 5 ? [46, 125, 50] : s < 10 ? [139, 195, 74] : s < 15 ? [255, 235, 59] : s < 20 ? [255, 152, 0] : s < 25 ? [229, 57, 53] : [140, 20, 20]; }
      function tex(mode) { var c = document.createElement("canvas"); c.width = TW; c.height = TH; var g = c.getContext("2d");
        if (mode === "slope") { var sc = document.createElement("canvas"); sc.width = nx; sc.height = ny; var sg = sc.getContext("2d"), im = sg.createImageData(nx, ny);
          for (var k = 0; k < nx * ny; k++) { var col = slopeCol(sl[k]); im.data[k * 4] = col[0]; im.data[k * 4 + 1] = col[1]; im.data[k * 4 + 2] = col[2]; im.data[k * 4 + 3] = 255; }
          sg.putImageData(im, 0, 0); g.globalAlpha = 1; g.drawImage(sat, 0, 0); g.globalAlpha = .55; g.imageSmoothingEnabled = true; g.drawImage(sc, 0, 0, TW, TH); g.globalAlpha = 1;
          // 필지 안은 판정에 쓴 경사(산림청 10m 격자 등, c.s)로 덮어 결과 화면과 같은 값이 보이게
          var pc = document.createElement("canvas"); pc.width = D.nx; pc.height = D.ny; var pg = pc.getContext("2d"), pi = pg.createImageData(D.nx, D.ny);
          D.cells.forEach(function (cl) { if (cl.s === null || cl.s === undefined) return; var col = slopeCol(cl.s), ii = ((D.ny - 1 - cl.iy) * D.nx + cl.ix) * 4; pi.data[ii] = col[0]; pi.data[ii + 1] = col[1]; pi.data[ii + 2] = col[2]; pi.data[ii + 3] = 235; });
          pg.putImageData(pi, 0, 0); var q0 = toPx(b[0] + sh.dx, b[1] + sh.dy + D.ny * D.dlat), q1 = toPx(b[0] + sh.dx + D.nx * D.dlon, b[1] + sh.dy); g.imageSmoothingEnabled = false; g.drawImage(pc, q0[0], q0[1], q1[0] - q0[0], q1[1] - q0[1]); }
        else { g.drawImage(sat, 0, 0);
          if (mode === "st") { var cc = document.createElement("canvas"); cc.width = D.nx; cc.height = D.ny; var cg = cc.getContext("2d"), ci = cg.createImageData(D.nx, D.ny);
            D.cells.forEach(function (cl) { var col = o.cellColor(cl); if (!col) return; var ii = ((D.ny - 1 - cl.iy) * D.nx + cl.ix) * 4; ci.data[ii] = col[0]; ci.data[ii + 1] = col[1]; ci.data[ii + 2] = col[2]; ci.data[ii + 3] = 175; });
            cg.putImageData(ci, 0, 0); var p0 = toPx(b[0] + sh.dx, b[1] + sh.dy + D.ny * D.dlat), p1 = toPx(b[0] + sh.dx + D.nx * D.dlon, b[1] + sh.dy); g.imageSmoothingEnabled = false; g.drawImage(cc, p0[0], p0[1], p1[0] - p0[0], p1[1] - p0[1]); } }
        outline(g); var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
      var LG = { sat: "위성사진(브이월드) · 흰 선: 검토 필지", slope: "경사: <span style='color:#2e7d32'>■</span>5°미만 <span style='color:#8bc34a'>■</span>5–10° <span style='color:#ffeb3b'>■</span>10–15° <span style='color:#ff9800'>■</span>15–20° <span style='color:#e53935'>■</span>20–25° <span style='color:#8c1414'>■</span>25°이상<br><span style='font-size:12px'>필지 안(진한 색): 판정에 쓴 경사(산림청 10m 격자)와 같은 값 · 필지 밖(옅은 색): 표고로 계산한 참고값</span>", st: "<span style='color:#2ea05a'>■</span> 확실히 가능 <span style='color:#f3c623'>■</span> 신중검토 <span style='color:#b3261e'>■</span> 설치 불가" };
      // 장면
      var el = root, W = innerWidth, Hh = innerHeight, renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(W, Hh); root.appendChild(renderer.domElement);
      var scene = new THREE.Scene(); scene.background = new THREE.Color(0x0d0f12);
      var cam = new THREE.PerspectiveCamera(45, W / Hh, 1, 20000), span = Math.max(Wm, Hm);
      var geo = new THREE.PlaneGeometry(Wm, Hm, nx - 1, ny - 1), pos = geo.attributes.position, mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
      function setH(x) { for (var k = 0; k < nx * ny; k++) pos.setZ(k, (h[k] - mn) * x); pos.needsUpdate = true; geo.computeVertexNormals(); }
      setH(2); var mesh = new THREE.Mesh(geo, mat); mesh.rotation.x = -Math.PI / 2; scene.add(mesh);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.1)); var sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(-span * .4, span, span * .6); scene.add(sun);
      cam.position.set(span * .35, span * .38, span * .85); var ctl = new OC(cam, renderer.domElement); ctl.target.set(0, (mxh - mn), 0); ctl.enableDamping = true; ctl.maxPolarAngle = Math.PI * .49; ctl.update();
      var cache = {}; function mode(m) { mat.map = cache[m] || (cache[m] = tex(m)); mat.needsUpdate = true; root.querySelector("#t3lg").innerHTML = LG[m] + "<br><span style='opacity:.75;font-size:12px'>표고: Mapzen Terrarium(원자료 약 30m 해상도, 국토지리정보원 5m DEM 아님) · 판정 경사는 산림청 10m 격자 · 마우스 왼쪽 드래그 회전, 휠 확대, 오른쪽 드래그 이동 · 고저차 " + Math.round(mxh - mn) + "m</span>";
        root.querySelectorAll("#t3m button").forEach(function (x) { x.style.background = x.dataset.t === m ? "#fff" : "#1b1e23"; x.style.color = x.dataset.t === m ? "#111" : "#fff"; }); }
      root.querySelectorAll("#t3m button").forEach(function (x) { x.onclick = function () { mode(x.dataset.t); }; });
      root.querySelector("#t3x").onchange = function () { setH(+this.value); };
      mode(o.start || "st"); root.querySelector("#t3msg").remove();
      UI.renderer = renderer; UI.onRes = function () { var w = innerWidth, hh = innerHeight; renderer.setSize(w, hh); cam.aspect = w / hh; cam.updateProjectionMatrix(); }; window.addEventListener("resize", UI.onRes);
      (function loop() { if (!UI) return; UI.raf = requestAnimationFrame(loop); ctl.update(); renderer.render(scene, cam); })();
    } catch (e) { var m = root.querySelector("#t3msg"); if (m) m.textContent = "3D 지형을 만들지 못했습니다: " + (e && e.message || e); }
  }
  window.Terrain3D = { open: open, close: close };
})();
