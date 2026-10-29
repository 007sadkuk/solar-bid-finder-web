"""생태자연도 API(국립생태원) 응답 형식 확인용. 키는 로그에서 가림."""
import os, re, json, urllib.parse, urllib.request
from pyproj import Transformer
K = urllib.parse.unquote(os.environ.get("DATA_GO_KR_KEY", "").strip())
B = "https://apis.data.go.kr/B553084/ecoapi/EcologyzmpService/wfs/getEcologyzmpWFS"
t = Transformer.from_crs("EPSG:4326", "EPSG:5186", always_xy=True)
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "probe", "Origin": "https://007sadkuk.github.io"}), timeout=30) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()
for nm, (lo, la, d) in {"김천어모": (128.07, 36.17, 50), "소백산": (128.48, 36.95, 300), "가야산": (128.12, 35.82, 300)}.items():
    x, y = t.transform(lo, la)
    for lab, bb, extra in [("5186", f"{y-d},{x-d},{y+d},{x+d}", {}), ("5186-xy", f"{x-d},{y-d},{x+d},{y+d}", {}), ("4326out", f"{y-d},{x-d},{y+d},{x+d}", {"srsName": "EPSG:4326"})]:
        q = dict({"ServiceKey": K, "typeName": "tbl_opn_eczm", "srsName": "EPSG:5186", "bbox": bb, "outputFormat": "application/json"}, **extra)
        s, h, b = get(B + "?" + urllib.parse.urlencode(q))
        try:
            j = json.loads(b)
            fs = j.get("features", [])
            print(nm, lab, s, "CORS:", h.get("Access-Control-Allow-Origin"), "n=", len(fs))
            for f in fs[:3]:
                c = f["geometry"]["coordinates"][0][0][0]
                print("   props:", json.dumps(f["properties"], ensure_ascii=False)[:400], "first:", c)
        except Exception as e:  # noqa: BLE001
            print(nm, lab, s, b[:200])
