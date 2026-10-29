"""국토교통부 토지 매매 실거래가 → docs/trades/<시군구5>.json (대구·경북)
API: https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade
요청: serviceKey, LAWD_CD(시군구 5자리), DEAL_YMD(YYYYMM), pageNo, numOfRows  (응답 XML)
키: GitHub 시크릿 DATA_GO_KR_KEY (공공데이터포털 '일반 인증키(Decoding)' 값)
한 번 실행: 아직 없는 달 + 최근 3개월(신고 지연·해제 반영)을 다시 받음. 개발계정 하루 1,000건 제한 → MAX_CALLS로 나눠 받음.
응답 항목 이름은 영문(dealAmount 등)과 옛 한글(거래금액 등)을 모두 받아들임. 첫 응답의 항목 이름을 meta.keys에 남겨 확인."""
import os, re, json, time, datetime, urllib.parse, urllib.request, urllib.error
import xml.etree.ElementTree as ET

URL = "https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "trades")
SGG = ["27110", "27140", "27170", "27200", "27230", "27260", "27290", "27710", "27720",
       "47111", "47113", "47130", "47150", "47170", "47190", "47210", "47230", "47250", "47280", "47290",
       "47730", "47750", "47760", "47770", "47820", "47830", "47840", "47850", "47900", "47920", "47930", "47940"]
MONTHS = int(os.environ.get("TRADE_MONTHS", "36"))
MAX_CALLS = int(os.environ.get("TRADE_MAX_CALLS", "900"))
REFRESH = 3

F = {  # 표준 이름: 가능한 응답 항목 이름들
    "amount": ["dealAmount", "거래금액"], "area": ["dealArea", "거래면적"], "jimok": ["jimok", "지목"],
    "use": ["landUse", "용도지역"], "umd": ["umdNm", "법정동"], "jibun": ["jibun", "지번"],
    "y": ["dealYear", "년"], "m": ["dealMonth", "월"], "d": ["dealDay", "일"],
    "cancel": ["cdealType", "해제여부"], "share": ["shareDealingType", "구분", "거래유형"], "gbn": ["dealingGbn"],
}


def g(it, k):
    for n in F[k]:
        v = it.get(n)
        if v not in (None, ""):
            return v.strip()
    return ""


def num(v):
    try:
        return float(str(v).replace(",", "").strip())
    except ValueError:
        return None


def call(key, sgg, ymd, page):
    q = urllib.parse.urlencode({"serviceKey": key, "LAWD_CD": sgg, "DEAL_YMD": ymd, "pageNo": page, "numOfRows": 1000})
    req = urllib.request.Request(URL + "?" + q, headers={"User-Agent": "land-value"})
    with urllib.request.urlopen(req, timeout=40) as r:
        body = r.read().decode("utf-8", "replace")
    root = ET.fromstring(body)
    code = (root.findtext(".//resultCode") or "").strip()
    if code not in ("00", "000", ""):
        raise RuntimeError("resultCode " + code + " " + (root.findtext(".//resultMsg") or "")[:120])
    if root.tag == "OpenAPI_ServiceResponse" or root.find(".//returnAuthMsg") is not None:
        raise RuntimeError("인증 오류: " + (root.findtext(".//returnAuthMsg") or body[:120]))
    items = [{c.tag: (c.text or "") for c in it} for it in root.iter("item")]
    total = int((root.findtext(".//totalCount") or "0").strip() or 0)
    return items, total


def main():
    key = os.environ.get("DATA_GO_KR_KEY", "").strip()
    if "%" in key:  # Encoding 키를 넣은 경우 → Decoding 값으로 바꿔 사용(이중 인코딩 방지)
        key = urllib.parse.unquote(key)
    os.makedirs(OUT, exist_ok=True)
    KST = datetime.timezone(datetime.timedelta(hours=9))
    now = datetime.datetime.now(KST)
    months = []
    y, m = now.year, now.month
    for _ in range(MONTHS):
        months.append(f"{y}{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    meta_p = os.path.join(OUT, "meta.json")
    try:
        meta = json.load(open(meta_p, encoding="utf-8"))
    except Exception:  # noqa: BLE001
        meta = {}
    meta.update({"source": URL, "run_at": now.strftime("%Y-%m-%d %H:%M"), "errors": []})
    if not key:
        meta["errors"].append("DATA_GO_KR_KEY 시크릿이 없습니다")
        json.dump(meta, open(meta_p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("no key")
        return
    calls = 0
    stop = False
    for sgg in SGG:
        p = os.path.join(OUT, sgg + ".json")
        try:
            cur = json.load(open(p, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            cur = {"sgg": sgg, "done": {}, "rows": {}}
        changed = False
        for i, ym in enumerate(months):
            if stop:
                break
            if ym in cur["done"] and i >= REFRESH:
                continue
            if calls >= MAX_CALLS:
                stop = True
                break
            rows, page = [], 1
            try:
                while True:
                    calls += 1
                    items, total = call(key, sgg, ym, page)
                    if items and not meta.get("keys"):
                        meta["keys"] = sorted(items[0].keys())
                    for it in items:
                        if g(it, "cancel") in ("O", "o"):
                            continue  # 해제된 거래 제외
                        a, ar = num(g(it, "amount")), num(g(it, "area"))
                        if not a or not ar:
                            continue
                        yy, mm, dd = g(it, "y"), g(it, "m"), g(it, "d")
                        rows.append([f"{yy}{int(mm or 0):02d}{int(dd or 0):02d}", g(it, "umd"), g(it, "jimok"), g(it, "use"),
                                     round(ar, 1), int(a), g(it, "jibun"), g(it, "share")])
                    if page * 1000 >= total or not items:
                        break
                    page += 1
                    time.sleep(0.3)
            except urllib.error.HTTPError as e:
                try:
                    body = e.read().decode("utf-8", "replace")
                except Exception:  # noqa: BLE001
                    body = ""
                body = re.sub(r"\s+", " ", body)[:200]
                meta["errors"].append(f"{sgg} {ym}: HTTP {e.code} {body}")
                if e.code in (401, 403, 429):
                    stop = True
                continue
            except Exception as e:  # noqa: BLE001
                meta["errors"].append(f"{sgg} {ym}: {str(e)[:160]}")
                if "인증" in str(e) or "LIMITED" in str(e) or str(e).startswith(("resultCode 22", "resultCode 30", "resultCode 31", "resultCode 20")):
                    stop = True
                continue
            cur["rows"][ym] = rows
            cur["done"][ym] = now.strftime("%Y-%m-%d")
            changed = True
            time.sleep(0.2)
        # 기간 밖 달 정리
        keep = set(months)
        cur["rows"] = {k: v for k, v in cur["rows"].items() if k in keep}
        cur["done"] = {k: v for k, v in cur["done"].items() if k in keep}
        if changed:
            cur["updated"] = now.strftime("%Y-%m-%d")
            with open(p, "w", encoding="utf-8") as f:
                json.dump(cur, f, ensure_ascii=False, separators=(",", ":"))
        if stop:
            break
    meta["calls"] = calls
    meta["errors"] = meta["errors"][:20]
    json.dump(meta, open(meta_p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("trades: calls", calls, "errors", len(meta["errors"]))
    for e in meta["errors"][:5]:
        print("ERR", e)


if __name__ == "__main__":
    main()
