"""한전 전력데이터개방포털 분산전원연계 정보(여유용량) 조회 → docs/kepco.json
API: https://bigdata.kepco.co.kr/openapi/v1/dispersedGeneration.do
요청: metroCd(시도 2자리), cityCd(시군구 3자리), addrLidong(읍면동), addrLi(리), addrJibun(번지), apiKey, returnType=json
응답: data[] {substNm, vol1(변전소 여유), vol2(변압기 여유), vol3(DL 여유), ...}
키는 GitHub 시크릿 KEPCO_API_KEY. 표준 라이브러리만 사용."""
import json, os, re, time, datetime, urllib.parse, urllib.request, urllib.error

URL = "https://bigdata.kepco.co.kr/openapi/v1/dispersedGeneration.do"
TTL_DAYS = 7          # 같은 물건은 7일마다 다시 조회
MAX_CALLS = 400       # 한 번 실행에 최대 호출 수(한도 미확인이라 보수적으로)
RUN_SECONDS = 25 * 60 # 한 번 실행에 최대 25분

EMD_RE = re.compile(r"^[가-힣]+(?:읍|면|동|\d+가|가)$")
LI_RE = re.compile(r"^[가-힣]+리$")
JIBUN_RE = re.compile(r"^(산)?\s*(\d{1,4})(?:-(\d{1,4}))?")


SGG = {}  # (sido, sigungu) → 5자리 코드. 필지번호가 있는 물건에서 학습


def learn_codes(items):
    for i in items:
        pnu = str(i.get("pnu") or "")
        if len(pnu) == 19 and i.get("sido") and i.get("sigungu"):
            SGG.setdefault((i["sido"], i["sigungu"]), pnu[:5])


def parse_addr(item):
    """물건명에서 읍면동·리·번지를 뽑는다. 시도·시군구 코드는 PNU 앞 5자리(없으면 같은 시군구 물건에서 학습한 코드)."""
    pnu = str(item.get("pnu") or "")
    code = pnu[:5] if len(pnu) == 19 else SGG.get((item.get("sido"), item.get("sigungu")))
    if not code:
        return None
    name = re.sub(r"\s+", " ", str(item.get("name") or "")).strip()
    toks = name.split(" ")
    emd = li = None
    jibun = None
    for i, t in enumerate(toks):
        if i < 2:
            continue  # 시도, 시군구(구 포함 3번째까지 가능)
        if emd is None and EMD_RE.match(t) and not re.search(r"\d+동$", t):
            emd = t
            continue
        if emd and li is None and LI_RE.match(t):
            li = t
            continue
        if emd:
            rest = " ".join(toks[i:])
            m = JIBUN_RE.match(rest)
            if m:
                jibun = ("산" if m.group(1) else "") + m.group(2) + ("-" + m.group(3) if m.group(3) else "")
            break
    if not emd:
        return None
    return {"metroCd": code[:2], "cityCd": code[2:5], "addrLidong": emd, "addrLi": li or "", "addrJibun": jibun or ""}


def _num(v):
    try:
        s = str(v).replace(",", "").strip()
        return float(s) if s not in ("", "None", "null") else None
    except ValueError:
        return None


def call(key, q, timeout=30):
    p = {k: v for k, v in q.items() if v}
    p.update({"apiKey": key, "returnType": "json"})
    req = urllib.request.Request(URL + "?" + urllib.parse.urlencode(p), headers={"User-Agent": "solar-bid-finder"})
    body = None
    for attempt in range(3):  # 접속 시간 초과는 잠시 쉬고 재시도
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read().decode("utf-8", "replace")
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:  # 한전은 해당 주소 자료가 없으면 404를 준다(2026-10-28 실측) → 결과 없음으로 처리
                return []
            raise
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt == 2:
                raise
            time.sleep(5 * (attempt + 1))
    try:
        j = json.loads(body)
    except ValueError:
        raise RuntimeError("JSON 아님: " + body[:200])
    data = j.get("data")
    if data is None:
        raise RuntimeError("data 없음: " + body[:200])
    rows = []
    for d in data:
        rows.append({"sub": d.get("substNm"), "subCd": d.get("substCd"), "mtr": d.get("mtrNo"), "dl": d.get("dlNm"),
                     "v1": _num(d.get("vol1")), "v2": _num(d.get("vol2")), "v3": _num(d.get("vol3")),
                     "subPwr": _num(d.get("substPwr")), "mtrPwr": _num(d.get("mtrPwr")), "dlPwr": _num(d.get("dlPwr"))})
    return rows


def run(items, out_path, key, scrub=lambda s: s, log=print):
    KST = datetime.timezone(datetime.timedelta(hours=9))
    now = datetime.datetime.now(KST)
    try:
        with open(out_path, encoding="utf-8") as f:
            prev = json.load(f)
    except Exception:  # noqa: BLE001
        prev = {}
    cache = prev.get("items", {})
    learn_codes(items)
    meta = {"fetched_at": now.strftime("%Y-%m-%d %H:%M"), "calls": 0, "ok": 0, "errors": [], "skipped_no_addr": 0,
            "source": URL}
    if not key:
        meta["errors"].append("KEPCO_API_KEY 시크릿이 설정되지 않았습니다")
    # 대상: 토지·매각, 면적 있는 물건. 오래된 캐시 먼저
    cand = [i for i in items if "토지" in str(i.get("cat_path") or "") and i.get("disposal") == "매각" and i.get("area_m2")]
    def age(i):
        c = cache.get(i["mgmt_no"])
        return c.get("ts", "") if c else ""
    cand.sort(key=age)
    cut = (now - datetime.timedelta(days=TTL_DAYS)).strftime("%Y-%m-%d %H:%M")
    consec_err = 0
    t0 = time.time()
    for it in cand:
        if not key or meta["calls"] >= MAX_CALLS or consec_err >= 5 or time.time() - t0 > RUN_SECONDS:
            break
        c = cache.get(it["mgmt_no"])
        if c and c.get("ts", "") >= cut and not c.get("err"):
            continue
        q = parse_addr(it)
        if not q:
            meta["skipped_no_addr"] += 1
            cache[it["mgmt_no"]] = {"ts": now.strftime("%Y-%m-%d %H:%M"), "err": "주소(읍면동)를 물건명에서 찾지 못함"}
            continue
        level, rows, err = None, None, None
        tries = [("지번", q)] if q["addrJibun"] else []
        if q["addrLi"]:
            tries.append(("리", dict(q, addrJibun="")))
        tries.append(("읍면동", dict(q, addrLi="", addrJibun="")))
        for lv, qq in tries:
            try:
                meta["calls"] += 1
                rows = call(key, qq)
                consec_err = 0
                if rows:
                    level = lv
                    break
            except Exception as e:  # noqa: BLE001
                err = scrub(str(e))[:240]
                consec_err += 1
                if len(meta["errors"]) < 8:
                    meta["errors"].append(f"{it['mgmt_no']}: {err}")
                break
            time.sleep(1.0)
        if level:
            meta["ok"] += 1
            cache[it["mgmt_no"]] = {"ts": now.strftime("%Y-%m-%d %H:%M"), "level": level, "q": q, "rows": rows[:30]}
        elif err:
            cache[it["mgmt_no"]] = {"ts": now.strftime("%Y-%m-%d %H:%M"), "err": err, "q": q}
        else:
            cache[it["mgmt_no"]] = {"ts": now.strftime("%Y-%m-%d %H:%M"), "err": "조회 결과 없음", "q": q}
    if consec_err >= 5:
        meta["errors"].append("연속 오류 5회로 중단")
    live = {i["mgmt_no"] for i in items}
    cache = {k: v for k, v in cache.items() if k in live}
    meta["cached"] = len(cache)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "items": cache}, f, ensure_ascii=False)
    log(f"kepco: calls={meta['calls']} ok={meta['ok']} cached={len(cache)} errors={len(meta['errors'])}")
    for e in meta["errors"]:
        log("KEPCO ERR " + e)
    return meta
