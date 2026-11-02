"""9정맥 종주코스 GPX(공공데이터포털 15098181, 한국등산트레킹지원센터) → docs/ridges.json
정맥 능선 위 종주 코스 선형을 정맥 위치의 근사로 사용(기맥·지맥은 없음). 20m 허용오차로 단순화."""
import re, io, json, zipfile, math, urllib.request, urllib.parse, http.cookiejar, xml.etree.ElementTree as ET, os
cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
PAGE = "https://www.data.go.kr/data/15098181/fileData.do"
H = {"User-Agent": "Mozilla/5.0", "Referer": PAGE, "X-Requested-With": "XMLHttpRequest"}
def req(u, data=None):
    r = op.open(urllib.request.Request(u, data=data, headers=H), timeout=120); return r.read(), r.headers
h = req(PAGE)[0].decode("utf-8", "replace")
m = re.search(r"fn_fileDataDown\('(\d+)',\s*'([^']+)',\s*'([^']*)',\s*'(\d+)',\s*'(\d+)'\)", h)
pk, dpk, att, sn, hist = m.groups(); print("args", m.groups())
body = urllib.parse.urlencode({"publicDataDetailPk": dpk, "publicDataPk": pk, "atchFileId": att, "fileDetailSn": sn, "publicDataTyCode": "PR0051"}).encode()
j = json.loads(req("https://www.data.go.kr/tcs/dss/selectFileDataDownload.do", body)[0].decode("utf-8", "replace"))
print("resp keys", list(j.keys()), j.get("status"))
fid, fsn = j["atchFileId"], j["fileDetailSn"]
raw, hd = req("https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=%s&fileDetailSn=%s" % (fid, fsn))
print("downloaded", len(raw), hd.get("Content-Disposition"))
files = {}
if raw[:2] == b"PK":
    z = zipfile.ZipFile(io.BytesIO(raw))
    for n in z.namelist():
        if n.lower().endswith(".gpx"): files[n] = z.read(n)
else: files["data.gpx"] = raw
def simp(pts, tol):
    if len(pts) < 3: return pts
    lat0 = math.radians(pts[0][1]); kx = 111320 * math.cos(lat0); ky = 110540
    def d(p, a, b):
        ax, ay, bx, by, px, py = a[0]*kx, a[1]*ky, b[0]*kx, b[1]*ky, p[0]*kx, p[1]*ky
        L = (bx-ax)**2 + (by-ay)**2
        t = 0 if L == 0 else max(0, min(1, ((px-ax)*(bx-ax)+(py-ay)*(by-ay))/L))
        return math.hypot(px-ax-t*(bx-ax), py-ay-t*(by-ay))
    keep = [0, len(pts)-1]; st = [(0, len(pts)-1)]
    while st:
        i, k = st.pop(); best, bi = 0, -1
        for q in range(i+1, k):
            dd = d(pts[q], pts[i], pts[k])
            if dd > best: best, bi = dd, q
        if best > tol: keep.append(bi); st += [(i, bi), (bi, k)]
    return [pts[i] for i in sorted(set(keep))]
out = []
for n, b in files.items():
    t = b.decode("utf-8", "replace"); t = re.sub(r'xmlns="[^"]+"', "", t, count=1)
    root = ET.fromstring(t)
    name = (root.findtext(".//trk/name") or root.findtext(".//metadata/name") or os.path.basename(n)).strip()
    for seg in root.iter("trkseg"):
        pts = [[round(float(p.get("lon")), 6), round(float(p.get("lat")), 6)] for p in seg.iter("trkpt")]
        if len(pts) > 1: out.append({"n": name, "file": os.path.basename(n), "p": simp(pts, 20)})
    for rte in root.iter("rte"):
        pts = [[round(float(p.get("lon")), 6), round(float(p.get("lat")), 6)] for p in rte.iter("rtept")]
        if len(pts) > 1: out.append({"n": name, "file": os.path.basename(n), "p": simp(pts, 20)})
print("lines", len(out), [(o["n"], len(o["p"])) for o in out][:20])
json.dump({"source": "공공데이터포털 15098181 한국등산트레킹지원센터_9정맥 종주코스(GPX)", "note": "정맥 종주 코스 선형(능선 근사), 20m 단순화", "lines": out}, open("docs/ridges.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
