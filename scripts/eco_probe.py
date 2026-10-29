import os, json, urllib.parse, urllib.request
from pyproj import Transformer
K = urllib.parse.unquote(os.environ.get("DATA_GO_KR_KEY", "").strip())
B = "https://apis.data.go.kr/B553084/ecoapi/EcologyzmpService/wfs/getEcologyzmpWFS"
t = Transformer.from_crs("EPSG:4326", "EPSG:5186", always_xy=True)
x, y = t.transform(128.12, 35.82); d = 800
for extra in [{}, {"maxFeatures": "500"}, {"count": "500"}, {"maxFeatures": "500", "count": "500"}]:
    q = dict({"ServiceKey": K, "typeName": "tbl_opn_eczm", "srsName": "EPSG:5186", "bbox": f"{x-d},{y-d},{x+d},{y+d}", "outputFormat": "application/json"}, **extra)
    try:
        with urllib.request.urlopen(B + "?" + urllib.parse.urlencode(q), timeout=40) as r:
            j = json.loads(r.read()); fs = j.get("features", [])
            print(extra, "n=", len(fs), "total", j.get("totalFeatures"), "grades", sorted({f["properties"]["eczm_grad"] for f in fs}))
    except Exception as e:  # noqa: BLE001
        print(extra, "ERR", str(e)[:200])
