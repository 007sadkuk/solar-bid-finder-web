"""생태자연도 API(국립생태원) 응답 형식 확인용. 키는 로그에서 가림."""
import os, re, urllib.parse, urllib.request
from pyproj import Transformer
K = urllib.parse.unquote(os.environ.get("DATA_GO_KR_KEY", "").strip())
B = "https://apis.data.go.kr/B553084/ecoapi/EcologyzmpService"
t = Transformer.from_crs("EPSG:4326", "EPSG:5186", always_xy=True)
pts = {"소백산": (128.48, 36.95), "김천어모": (128.07, 36.17), "대구시내": (128.60, 35.87)}
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "probe"}), timeout=30) as r:
            b = r.read(); ct = r.headers.get("Content-Type", "")
            return r.status, ct, b
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", ""), e.read()
    except Exception as e:  # noqa: BLE001
        return 0, "", str(e).encode()
def show(name, u):
    s, ct, b = get(u)
    txt = b[:600].decode("utf-8", "replace") if "image" not in ct else f"<image {len(b)} bytes>"
    print(f"== {name}: {s} {ct}\n{re.sub(r'\\s+', ' ', txt)}\n".replace(K, "KEY"))
for nm, (lo, la) in pts.items():
    x, y = t.transform(lo, la)
    d = 50
    bb = f"{y-d},{x-d},{y+d},{x+d}"
    q = lambda **kw: urllib.parse.urlencode(dict({"ServiceKey": K}, **kw))
    show(nm + " WMS", B + "/wms/getEcologyzmpWMS?" + q(layers="tbl_opn_eczm", srs="EPSG:5186", bbox=bb, width=2, height=2, format="png", transparent="true"))
    show(nm + " WMS GetFeatureInfo", B + "/wms/getEcologyzmpWMS?" + q(request="GetFeatureInfo", layers="tbl_opn_eczm", query_layers="tbl_opn_eczm", srs="EPSG:5186", bbox=bb, width=3, height=3, x=1, y=1, info_format="application/json"))
    for op in ["wfs/getEcologyzmpWFS", "wfs/getEcologyzmpWfs", "attr/getEcologyzmpAttr", "getEcologyzmpAttr", "attribute/getEcologyzmpAttribute"]:
        show(nm + " " + op, B + "/" + op + "?" + q(typeName="tbl_opn_eczm", layers="tbl_opn_eczm", srsName="EPSG:5186", srs="EPSG:5186", bbox=bb, outputFormat="application/json", type="json", numOfRows=5, pageNo=1))
    if nm != "소백산":
        break
