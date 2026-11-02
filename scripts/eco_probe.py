import os, json, re, urllib.parse, urllib.request
from pyproj import Transformer
K = urllib.parse.unquote(os.environ.get("DATA_GO_KR_KEY", "").strip())
B = "https://apis.data.go.kr/B553084/ecoapi/EcologyzmpService/wfs/getEcologyzmpWFS"
t = Transformer.from_crs("EPSG:4326", "EPSG:5186", always_xy=True)
def get(q):
    with urllib.request.urlopen(B + "?" + urllib.parse.urlencode(dict({"ServiceKey": K}, **q)), timeout=40) as r:
        return r.read().decode("utf-8", "replace")
# 1) 속성 이름 전체(영천 금호읍 부근)
x, y = t.transform(128.875, 35.935); d = 1500
try:
    j = json.loads(get({"typeName": "tbl_opn_eczm", "srsName": "EPSG:5186", "bbox": f"{x-d},{y-d},{x+d},{y+d}", "outputFormat": "application/json"}))
    fs = j.get("features", [])
    print("n", len(fs)); keys = set()
    for f in fs: keys |= set(f["properties"].keys())
    print("keys", sorted(keys))
    for f in fs[:5]: print(json.dumps(f["properties"], ensure_ascii=False)[:400])
except Exception as e: print("ERR1", str(e)[:300])
# 2) 서비스 목록
for q in [{"service": "WFS", "request": "GetCapabilities"}, {"service": "WFS", "version": "1.1.0", "request": "DescribeFeatureType", "typeName": "tbl_opn_eczm"}]:
    try:
        s = get(q); print("---", q.get("request"), len(s)); print(re.sub(r"\s+", " ", s)[:3000])
    except Exception as e: print("ERR", q.get("request"), str(e)[:200])
