import os, json, re, urllib.parse, urllib.request
from pyproj import Transformer
K = urllib.parse.unquote(os.environ.get("DATA_GO_KR_KEY", "").strip())
B = "https://apis.data.go.kr/B553084/ecoapi/EcologyzmpService/wfs/getEcologyzmpWFS"
t = Transformer.from_crs("EPSG:4326", "EPSG:5186", always_xy=True)
def get(q, to=90):
    try:
        with urllib.request.urlopen(B + "?" + urllib.parse.urlencode(dict({"ServiceKey": K}, **q)), timeout=to) as r:
            return r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return "HTTP %s %s" % (e.code, e.read().decode("utf-8", "replace")[:500])
    except Exception as e:
        return "ERR " + str(e)[:200]
x, y = t.transform(126.4950, 36.8310); d = 400
for tn in ["tbl_opn_vtn_evl", "open:tbl_opn_vtn_evl", "tbl_opn_smld_evl"]:
    for fmt in ["application/json", None]:
        q = {"typeName": tn, "srsName": "EPSG:5186", "bbox": f"{x-d},{y-d},{x+d},{y+d}", "maxFeatures": "5"}
        if fmt: q["outputFormat"] = fmt
        s = get(q); print("==", tn, fmt, len(s)); print(re.sub(r"\s+", " ", s)[:1500])
for tn in ["tbl_opn_vtn_evl", "tbl_opn_smld_evl"]:
    s = get({"service": "WFS", "version": "1.0.0", "request": "DescribeFeatureType", "typeName": tn}); print("== DESC", tn); print(re.sub(r"\s+", " ", s)[:1500])
