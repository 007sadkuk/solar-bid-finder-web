"""온비드 수집 → docs/data.json (GitHub Actions에서 실행). 표준 라이브러리만 사용."""
import json, os, sys, datetime, urllib.parse, urllib.request, urllib.error, socket, time
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
                    n["pnu"] = r.get("ltnoPnu") or ""
                    n["onbid"] = {k: r.get(k) for k in ("onbidCltrno", "onbidPbancNo", "pbctNo", "pbctCdtnNo", "prptDivCd")}
                    merged[n["mgmt_no"]] = n
    out["items"] = sorted(merged.values(), key=lambda x: x.get("bid_end") or "9")

# ── 신규 판정: 처음 본 시각(first_seen)을 기록해 둔다. 직전 data.json과 비교하며, 일시 실패에도 신규로 오판하지 않도록
#    사라진 항목의 기록을 14일간 보관한다. 이력이 없던 기존 항목은 '기준(2000-01-01)'으로 두어 신규에서 제외한다.
BASE = "2000-01-01 00:00"
prev = {}
try:
    with open(OUT, encoding="utf-8") as f:
        prev = json.load(f)
except Exception:  # noqa: BLE001
    prev = {}
now = out["fetched_at"]
prev_items = prev.get("items") or []
prev_seen = prev.get("seen")
if prev_seen is None:
    prev_seen = {i["mgmt_no"]: [BASE, prev.get("fetched_at") or now] for i in prev_items}
if not out["items"] and prev_items:     # 수집 전체 실패 시 이전 목록을 유지(빈 화면 방지)
    out["items"] = prev_items
    out["stale"] = True
    out["fetched_at_prev"] = prev.get("fetched_at")
first_run = not prev_items and not prev_seen
seen = {}
for it in out["items"]:
    k = it["mgmt_no"]
    first = prev_seen[k][0] if k in prev_seen else (BASE if first_run else now)
    it["first_seen"] = first
    seen[k] = [first, now if not out.get("stale") else prev_seen.get(k, [first, now])[1]]
cut = (datetime.datetime.now(KST) - datetime.timedelta(days=14)).strftime("%Y-%m-%d %H:%M")
for k, v in prev_seen.items():
    if k not in seen and v[1] >= cut:
        seen[k] = v
out["seen"] = seen
print("items:", len(out["items"]), "errors:", len(out["errors"]), "passes:", out["passes"])
for e in out["errors"]:
    print("ERR", e)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)

# ── 한전 분산전원 연계 여유용량 (docs/kepco.json) ──
try:
    import kepco
    kkey = os.environ.get("KEPCO_API_KEY", "").strip()
    secrets.append(kkey)
    if out["items"]:
        kepco.run(out["items"], os.path.join(os.path.dirname(OUT), "kepco.json"), kkey, scrub=scrub)
except Exception as e:  # noqa: BLE001  (한전 쪽 실패가 온비드 수집을 막지 않도록)
    print("KEPCO 단계 실패:", scrub(e)[:300])
