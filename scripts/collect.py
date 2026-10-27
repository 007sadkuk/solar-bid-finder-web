"""온비드 수집 → docs/data.json (GitHub Actions에서 실행). 표준 라이브러리만 사용."""
import json, os, sys, datetime, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import onbid

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "data.json")
raw_key = os.environ.get("ONBID_SERVICE_KEY", "").strip()
secrets = [raw_key]
if raw_key:
    secrets.append(onbid._decode_key(raw_key))
    secrets.append(urllib.parse.quote(onbid._decode_key(raw_key), safe=""))


def scrub(t):
    t = str(t)
    for s in secrets:
        if s:
            t = t.replace(s, "***")
    return t


KST = datetime.timezone(datetime.timedelta(hours=9))
out = {"fetched_at": datetime.datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "errors": [], "passes": [],
       "complete": True, "fields": [], "first_raw": None, "items": []}
if not raw_key:
    out["errors"].append("ONBID_SERVICE_KEY 시크릿이 설정되지 않았습니다")
else:
    key = onbid._decode_key(raw_key)
    endpoint = os.environ.get("ONBID_ENDPOINT", "").strip() or onbid.DEFAULT_ENDPOINT
    merged = {}
    for sido in ("대구광역시", "경상북도"):
        for pvct in ("N", "Y"):
            try:
                recs, ok = onbid._fetch_pass(endpoint, key, 100, onbid.DEFAULT_PRPT, sido, pvct)
            except Exception as e:  # noqa: BLE001
                out["errors"].append(f"{sido}/{pvct}: {scrub(e)[:300]}")
                out["complete"] = False
                out["passes"].append({"sido": sido, "pvct": pvct, "count": None})
                continue
            out["complete"] = out["complete"] and ok
            out["passes"].append({"sido": sido, "pvct": pvct, "count": len(recs), "complete": ok})
            for r in recs:
                if out["first_raw"] is None:
                    out["first_raw"] = r
                    out["fields"] = list(r.keys())
                n = onbid._normalize(r)
                if n:
                    n["cat_path"] = " > ".join(x for x in (r.get("cltrUsgLclsCtgrNm"), r.get("cltrUsgMclsCtgrNm"),
                                                           r.get("cltrUsgSclsCtgrNm")) if x)
                    n["status"] = r.get("pbctStatNm") or ""
                    n["share"] = r.get("alcYn") == "Y"
                    merged[n["mgmt_no"]] = n
    out["items"] = sorted(merged.values(), key=lambda x: x.get("bid_end") or "9")
print("items:", len(out["items"]), "errors:", len(out["errors"]), "passes:", out["passes"])
for e in out["errors"]:
    print("ERR", e)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)
