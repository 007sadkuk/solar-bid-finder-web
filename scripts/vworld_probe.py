"""V-World 연결 시험(검증용). 키·도메인·레이어명이 맞는지 응답을 그대로 기록한다. 판정에는 쓰지 않는다."""
import json, os, urllib.parse, urllib.request, urllib.error

BASE = "https://api.vworld.kr/req/data"
LAYERS = ["LT_C_UQ111", "LT_C_UQ112", "LT_C_UQ113", "LT_C_UQ114", "LT_C_UF151", "LT_C_UM301", "LT_C_AGRIXUE101"]


def _get(params, key):
    url = BASE + "?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return None, type(e).__name__ + ": " + str(e)


def run(items, key, n=3):
    out = {"samples": []}
    cands = [i for i in items if i.get("pnu")][:n]
    if not key:
        return {"error": "VWORLD_KEY 없음"}
    if not cands:
        return {"error": "pnu가 있는 항목 없음"}
    for it in cands:
        rec = {"pnu": it["pnu"], "name": it.get("name")}
        for dom in ("", "localhost"):
            p = {"service": "data", "request": "GetFeature", "data": "LP_PA_CBND_BUBUN", "key": key, "format": "json",
                 "size": "1", "geometry": "true", "attrFilter": "pnu:=:" + it["pnu"]}
            if dom:
                p["domain"] = dom
            st, tx = _get(p, key)
            rec["parcel_domain=" + (dom or "없음")] = {"http": st, "body": tx.replace(key, "***")[:400]}
        out["samples"].append(rec)
    out["layers_tested_on"] = cands[0]["pnu"]
    out["layers"] = {}
    for ly in LAYERS:
        p = {"service": "data", "request": "GetFeature", "data": ly, "key": key, "format": "json", "size": "1",
             "geometry": "false", "domain": "localhost", "attrFilter": "pnu:=:" + cands[0]["pnu"]}
        st, tx = _get(p, key)
        out["layers"][ly] = {"http": st, "body": tx.replace(key, "***")[:250]}
    return out
