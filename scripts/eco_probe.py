import os, json, re, urllib.parse, urllib.request
from pyproj import Transformer
K = urllib.parse.unquote(os.environ.get("DATA_GO_KR_KEY", "").strip())
B = "https://apis.data.go.kr/B553084/ecoapi/EcologyzmpService/wfs/getEcologyzmpWFS"
t = Transformer.from_crs("EPSG:4326", "EPSG:5186", always_xy=True)
def get(q, to=60):
    with urllib.request.urlopen(B + "?" + urllib.parse.urlencode(dict({"ServiceKey": K}, **q)), timeout=to) as r:
        return r.read().decode("utf-8", "replace")
names = []
try:
    s = get({"service": "WFS", "request": "GetCapabilities"})
    names = re.findall(r"<Name>open:([A-Za-z0-9_]+)</Name>", s)
    print("TYPES", names)
except Exception as e: print("ERR cap", str(e)[:200])
# 영천 금호읍 원제리 부근 / 서산 명천리 부근
for lab, lon, lat in [("yeongcheon", 128.87, 35.93), ("seosan", 126.4950, 36.8310)]:
    x, y = t.transform(lon, lat); d = 600
    for tn in names or ["tbl_opn_eczm"]:
        try:
            j = json.loads(get({"typeName": tn, "srsName": "EPSG:5186", "bbox": f"{x-d},{y-d},{x+d},{y+d}", "outputFormat": "application/json"}))
            fs = j.get("features", []); keys = set()
            for f in fs: keys |= set(f["properties"].keys())
            print("==", lab, tn, "n", len(fs), sorted(keys))
            for f in fs[:4]:
                p = dict(f["properties"]); p.pop("bbox", None); print("   ", json.dumps(p, ensure_ascii=False)[:500])
        except Exception as e: print("==", lab, tn, "ERR", str(e)[:200])
