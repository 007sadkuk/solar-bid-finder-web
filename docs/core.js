/* ===== core: 순수 계산 함수 (지도/DOM 무관) ===== */
const rad = d => d * Math.PI / 180;
const deg = r => r * 180 / Math.PI;

function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function pointInPoly(pt, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i][0], yi = p[i][1], xj = p[j][0], yj = p[j][1];
    if ((yi > pt[1]) !== (yj > pt[1]) &&
        pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* 태양 위치: 위도, 날짜의 적위(deg), 태양시(h) → 고도(alt), 남쪽 기준 방위(az, 서쪽 +) */
function sunPos(latDeg, decDeg, hour) {
  const phi = rad(latDeg), dec = rad(decDeg), H = rad(15 * (hour - 12));
  const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  const alt = Math.asin(sinAlt);
  const az = Math.atan2(Math.sin(H), Math.sin(phi) * Math.cos(H) - Math.cos(phi) * Math.tan(dec));
  return { alt, az };
}

/* 동지(적위 -23.44°) 기준 행간. S = 경사면 길이(m), 반환 d = 수평 투영 깊이 */
function rowPitch({ lat, tiltDeg, S, azDeg, hours = [9, 15], decDeg = -23.44 }) {
  const b = rad(tiltDeg), d = S * Math.cos(b), h = S * Math.sin(b);
  const phiA = rad(azDeg);
  let worst = 0, detail = [];
  for (const t of hours) {
    const s = sunPos(lat, decDeg, t);
    const f = Math.max(0, Math.cos(s.az - phiA)) / Math.tan(s.alt);
    detail.push({ hour: t, altDeg: deg(s.alt), azDeg: deg(s.az), factor: f });
    worst = Math.max(worst, f);
  }
  return { d, h, pitch: d + h * worst, detail };
}

/* 선분-사각형 교차 (Liang–Barsky, 사각형 안에 완전히 들어간 선분도 true) */
function segHitsRect(a, b, r) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const P = [-dx, dx, -dy, dy];
  const Q = [a[0] - r[0], r[2] - a[0], a[1] - r[1], r[3] - a[1]];
  for (let i = 0; i < 4; i++) {
    if (P[i] === 0) { if (Q[i] < 0) return false; }
    else {
      const t = Q[i] / P[i];
      if (P[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
}

/* 배치: 부지 폴리곤(m) → 어레이 셀 목록 */
function layout(poly, o) {
  const phi = rad(o.azDeg);
  const U = [Math.cos(phi), -Math.sin(phi)];   // 어레이 열 방향
  const V = [Math.sin(phi), Math.cos(phi)];    // 뒷열 방향(어레이 정면의 반대)
  const P = poly.map(p => [p[0] * U[0] + p[1] * U[1], p[0] * V[0] + p[1] * V[1]]);
  const cw = o.portrait ? o.modW : o.modL;      // 모듈 1장의 열방향 폭
  const sd = o.portrait ? o.modL : o.modW;      // 모듈 1장의 경사면 길이
  const S = sd * o.k;
  const rp = rowPitch({ lat: o.lat, tiltDeg: o.tiltDeg, S, azDeg: o.azDeg });
  const d = rp.d;
  const pitch = Math.max(rp.pitch, d) + (o.extraGap || 0);
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const [u, v] of P) { umin = Math.min(umin, u); umax = Math.max(umax, u); vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
  const s = o.setback;
  const edges = P.map((p, i) => [p, P[(i + 1) % P.length]]);
  const est = ((umax - umin) / cw) * ((vmax - vmin) / pitch);
  const NV = est > 3e5 ? 1 : 6, NU = est > 3e5 ? 1 : 4;
  let best = null;
  for (let iv = 0; iv < NV; iv++) for (let iu = 0; iu < NU; iu++) {
    const cells = [];
    for (let v0 = vmin + s + (iv / NV) * pitch; v0 + d <= vmax - s; v0 += pitch) {
      for (let u0 = umin + s + (iu / NU) * cw; u0 + cw <= umax - s; u0 += cw) {
        const r = [u0 - s, v0 - s, u0 + cw + s, v0 + d + s];
        if (!pointInPoly([u0 + cw / 2, v0 + d / 2], P)) continue;
        let hit = false;
        for (const e of edges) if (segHitsRect(e[0], e[1], r)) { hit = true; break; }
        if (!hit) cells.push([u0, v0]);
      }
    }
    if (!best || cells.length > best.length) best = cells;
  }
  const cells = best || [];
  const modules = cells.length * o.k;
  return { cells, cw, d, S, pitch, U, V, modules, kW: modules * o.modP / 1000, rp, rowsModules: o.k };
}

/* IRR (이분법), cf[0] = 초기 투자(음수) */
function irr(cf) {
  const npv = r => cf.reduce((a, c, t) => a + c / Math.pow(1 + r, t), 0);
  let lo = -0.9, hi = 5.0;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

function economics({ kW, hoursPerDay, price, capexPerKW, omPerKW, degr, years }) {
  const capex = kW * capexPerKW;                    // 만원
  const gen1 = kW * hoursPerDay * 365;              // kWh
  const cf = [-capex], cum = [-capex], gens = [];
  let payback = null;
  for (let t = 1; t <= years; t++) {
    const g = gen1 * Math.pow(1 - degr, t - 1);
    gens.push(g);
    const net = g * price / 10000 - kW * omPerKW;
    cf.push(net);
    const prev = cum[t - 1];
    cum.push(prev + net);
    if (payback === null && prev < 0 && prev + net >= 0) payback = (t - 1) + (-prev) / net;
  }
  return { capex, gen1, rev1: gen1 * price / 10000, om1: kW * omPerKW, cf, cum, irr: capex > 0 ? irr(cf) : null, payback };
}

/* 목표 IRR을 맞추는 판매단가(원/kWh) 역산. o = { kW, hoursPerDay, capexPerKW, omPerKW, degr, years } */
function solvePrice(o, targetIrr) {
  if (!(o.kW > 0)) return null;
  const f = p => { const e = economics({ ...o, price: p }); return e.irr === null ? -1 : e.irr - targetIrr; };
  let lo = 0, hi = 3000;
  if (f(hi) < 0) return null;
  if (f(lo) >= 0) return 0;
  for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/* CSV (엑셀에서 한글이 깨지지 않도록 호출 쪽에서 BOM을 붙임) */
function toCsv(rows) {
  const q = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return rows.map(r => r.map(q).join(',')).join('\r\n');
}

if (typeof module !== 'undefined') module.exports = { rad, deg, polyArea, pointInPoly, sunPos, rowPitch, segHitsRect, layout, irr, economics, solvePrice, toCsv };
