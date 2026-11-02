import os, json, re, urllib.parse, urllib.request
from pyproj import Transformer
K = urllib.parse.unquote(os.environ.get("DATA_GO_KR_KEY", "").strip())
t = Transformer.from_crs("EPSG:4326", "EPSG:5186", always_xy=True)
def get(u, q, to=90):
    try:
        with urllib.request.urlopen(u + "?" + urllib.parse.urlencode(dict({"ServiceKey": K}, **q)), timeout=to) as r:
            return r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e: return "HTTP %s %s" % (e.code, e.read().decode("utf-8", "replace")[:400])
    except Exception as e: return "ERR " + str(e)[:200]
x, y = t.transform(126.4950, 36.8310); d = 300
for u in ["https://apis.data.go.kr/B553084/ecoapi/ActvnmapService/wfs/getActvnmapWFS", "https://apis.data.go.kr/B553084/ecoapi/ActvnmapService/wfs/getActvnmapWfs"]:
    for tn in ["tbl_opn_vtn_evl", "tbl_opn_actvnmap"]:
        s = get(u, {"typeName": tn, "srsName": "EPSG:5186", "bbox": f"{x-d},{y-d},{x+d},{y+d}", "outputFormat": "application/json"})
        print("==", u[-20:], tn, len(s))
        try:
            j = json.loads(s); fs = j.get("features", [])
            print("n", len(fs))
            for f in fs[:6]: p = dict(f["properties"]); p.pop("bbox", None); print("  ", json.dumps(p, ensure_ascii=False)[:400])
        except Exception: print(re.sub(r"\s+", " ", s)[:600])
s = get("https://apis.data.go.kr/B553084/ecoapi/ActvnmapService/wfs/getActvnmapWFS", {"service": "WFS", "request": "GetCapabilities"})
print("CAP", re.findall(r"<Name>([^<]+)</Name>", s)[:20], re.sub(r"\s+", " ", s)[:300])
