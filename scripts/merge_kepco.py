"""PC에서 받은 kepco.json을 docs/kepco.json에 합친다(물건별로 더 최근 성공값 우선).
사용: python scripts/merge_kepco.py <PC에서 가져온 kepco.json>"""
import json, sys, os
DOCS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "kepco.json")
src = json.load(open(sys.argv[1], encoding="utf-8"))
try:
    dst = json.load(open(DOCS, encoding="utf-8"))
except Exception:  # noqa: BLE001
    dst = {"meta": {}, "items": {}}
a, b = dst.get("items", {}), src.get("items", {})
added = 0
for k, v in b.items():
    cur = a.get(k)
    better = (v.get("rows") and (not cur or not cur.get("rows") or v.get("ts", "") > cur.get("ts", ""))) or (not cur)
    if better:
        a[k] = v
        added += 1
meta = dst.get("meta", {})
meta["local_merged_at"] = src.get("meta", {}).get("fetched_at")
meta["local_ok"] = src.get("meta", {}).get("ok")
meta["cached"] = len(a)
json.dump({"meta": meta, "items": a}, open(DOCS, "w", encoding="utf-8"), ensure_ascii=False)
print(f"merged: {added} updated, total {len(a)}, with rows {sum(1 for v in a.values() if v.get('rows'))}")
