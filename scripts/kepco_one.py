"""한 지번의 한전 여유용량 조회 → docs/kepcoq/<pnu>.json (workflow_dispatch 입력)"""
import json, os, sys, time, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kepco
key = os.environ.get("KEPCO_API_KEY", "").strip()
pnu, emd, li, jibun = os.environ["PNU"], os.environ["EMD"], os.environ.get("LI", ""), os.environ.get("JIBUN", "")
q = {"metroCd": pnu[:2], "cityCd": pnu[2:5], "addrLidong": emd, "addrLi": li, "addrJibun": jibun}
out = {"ts": datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime("%Y-%m-%d %H:%M"), "q": q, "tries": []}
for lv, qq in [("지번", q), ("리", dict(q, addrJibun="")), ("읍면동", dict(q, addrLi="", addrJibun=""))]:
    if lv == "리" and not li: continue
    try:
        rows = kepco.call(key, qq, timeout=40)
        out["tries"].append([lv, len(rows)])
        if rows: out.update({"level": lv, "rows": rows}); break
    except Exception as e:
        out["tries"].append([lv, str(e).replace(key, "***")[:200]])
    time.sleep(3)
os.makedirs("docs/kepcoq", exist_ok=True)
json.dump(out, open("docs/kepcoq/%s.json" % pnu, "w", encoding="utf-8"), ensure_ascii=False)
print(json.dumps(out, ensure_ascii=False)[:1500])
