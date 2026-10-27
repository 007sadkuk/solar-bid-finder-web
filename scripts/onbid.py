"""온비드(공공데이터포털) 부동산 물건목록 조회서비스 어댑터.

근거: 「Open API 활용가이드 — 온비드 부동산 물건목록 조회서비스」 v2.0 (배포일 2026/04/06)
  - 요청주소(운영): https://apis.data.go.kr/B010003/OnbidRlstListSrvc2
  - Call Back URL: [서비스URL]/getRlstCltrList2   (※ 같은 문서의 오퍼레이션 영문명은 getRlstCltrList —
    표기가 서로 다르므로 getRlstCltrList2를 기본으로 쓴다. 호출이 실패하면 ONBID_ENDPOINT로 바꿔볼 것)
  - 필수 요청값: serviceKey, pageNo, numOfRows, resultType, prptDivCd(재산유형, 쉼표로 복수), pvctTrgtYn(Y/N)
  - 응답: header.resultCode('00' 정상, '03' 데이터없음) + body.items.item[], body.totalCount

확인되지 않은 것 (실제 호출 결과로 검증 필요)
  - 응답 필드에 '지목'이 없다. 용도 분류명(cltrUsgSclsCtgrNm 등)만 있으므로 그 값을 land_category로 쓴다.
    용도 분류명이 설정 화면의 '허용 지목'과 어떻게 대응되는지는 첫 응답을 보고 확인해야 한다.
  - 시도 검색값(lctnSdnm)이 '대구광역시'/'경상북도'로 일치하는지(가이드 예시는 '경기도'). 응답은 한 번 더 클라이언트에서 거른다.
  - 가이드의 JSON 예시는 목록 항목 필드표와 달라(cltrRadr 등) 예시가 다른 서비스에서 온 것으로 보인다 → 필드표를 기준으로 구현.
  - 이 환경에서는 apis.data.go.kr 접속이 막혀 있어 실제 호출 테스트는 하지 못했다(모의 서버로 형식만 검증).

환경변수
  ONBID_SERVICE_KEY   인증키(필수). Encoding 키(%2B 등 포함)든 Decoding 키든 모두 허용
  ONBID_ENDPOINT      요청 URL (기본: 위 Call Back URL)
  ONBID_PAGE_SIZE     페이지당 건수(기본 100)
  ONBID_PRPT_CODES    재산유형코드(기본: 전체 10종, 쉼표 구분)
  ONBID_SIDO          조회할 시도(기본 '대구광역시,경상북도', 쉼표 구분)
"""
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_ENDPOINT = "https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2"
# 0007 압류, 0010 국유, 0005 기타일반, 0004 불용품, 0002 공유, 0003 금융권담보, 0006 유입, 0008 수탁, 0011 공공개발, 0013 파산
DEFAULT_PRPT = "0007,0010,0005,0004,0002,0003,0006,0008,0011,0013"
DEFAULT_SIDO = "대구광역시,경상북도"
CALL_INTERVAL = 0.15  # 가이드: 초당 최대 10 tps


class OnbidError(Exception):
    pass


def _decode_key(raw):
    """인증키가 Encoding 형태(%2B, %3D 등 포함)면 Decoding 형태로 되돌린다(요청 때 다시 인코딩하므로)."""
    raw = raw.strip()
    return urllib.parse.unquote(raw) if "%" in raw else raw


def _to_float(v):
    if v is None:
        return None
    try:
        return float(str(v).replace(",", "").strip())
    except ValueError:
        return None


def _to_int(v):
    f = _to_float(v)
    return int(f) if f is not None else None


def _dt(v):
    """yyyyMMddHHmm(또는 yyyyMMdd, yyyyMMddHHmmss) → 'YYYY-MM-DD HH:MM'"""
    if not v:
        return None
    s = re.sub(r"\D", "", str(v))
    if len(s) >= 12:
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]} {s[8:10]}:{s[10:12]}"
    if len(s) == 8:
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]} 00:00"
    return None


def _disposal(rec):
    nm = rec.get("dspsMthodNm") or ""
    cd = str(rec.get("dspsMthodCd") or "")
    if "임대" in nm or cd == "0002":
        return "임대"
    if "매각" in nm or cd == "0001":
        return "매각"
    return nm or None


def _normalize(rec):
    mgmt = rec.get("cltrMngNo")
    if not mgmt:
        return None
    cond = rec.get("pbctCdtnNo")  # 가이드: 물건관리번호는 공매조건번호와 함께 물건을 특정한다
    key = f"{mgmt}#{cond}" if cond not in (None, "") else str(mgmt)

    land_cat = rec.get("cltrUsgSclsCtgrNm") or rec.get("cltrUsgMclsCtgrNm") or None
    notes = []
    if rec.get("alcYn") == "Y":
        notes.append("지분물건")
    if rec.get("crtnYn") == "Y":
        notes.append("정정내역있음")
    for k in ("rentMthodNm", "cltrUsgMclsCtgrNm", "pbctStatNm"):
        if rec.get(k):
            notes.append(str(rec[k]))
    addr = " ".join(x for x in (rec.get("lctnSdnm"), rec.get("lctnSggnm"), rec.get("lctnEmdNm")) if x)

    return {
        "mgmt_no": key,
        "name": (rec.get("onbidCltrNm") or key).strip(),
        "address": addr or None,
        "sido": rec.get("lctnSdnm"),
        "sigungu": rec.get("lctnSggnm"),
        "land_category": land_cat,
        "area_m2": _to_float(rec.get("landSqms")),          # 토지면적(㎡)
        "appraisal": _to_int(rec.get("apslEvlAmt")),
        "min_bid": _to_int(rec.get("lowstBidPrcIndctCont")),  # '비공개'면 None
        "disposal": _disposal(rec),
        "bid_start": _dt(rec.get("cltrBidBgngDt")),
        "bid_end": _dt(rec.get("cltrBidEndDt")),
        "fail_count": _to_int(rec.get("usbdNft")) or 0,
        "remark": " / ".join(notes),
        "source_url": "https://www.onbid.co.kr/",
    }


def _parse(body_text):
    """JSON 응답 파싱. 인증 오류 등은 JSON이 아닌 XML로 올 수 있어 메시지를 뽑아 OnbidError로 올린다."""
    text = body_text.strip()
    if text.startswith("<"):
        msg = re.findall(r"<(?:returnAuthMsg|errMsg|resultMsg|returnReasonCode)>([^<]+)<", text)
        raise OnbidError("API 오류 응답(XML): " + (", ".join(msg) or text[:200]))
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise OnbidError(f"응답을 JSON으로 읽지 못했습니다: {e}") from e


def _request(url, retries=3):
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=25) as resp:
                return resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):  # 재시도해도 소용없는 인증/권한 오류
                raise OnbidError(f"HTTP {e.code}: 인증키/접근 권한을 확인하세요") from e
            last = e
        except (urllib.error.URLError, TimeoutError) as e:
            last = e
        time.sleep(1.5 * (attempt + 1))
    raise OnbidError(f"온비드 API 호출 실패: {last}")


def _items(payload):
    body = payload.get("response", payload).get("body", {}) if isinstance(payload, dict) else {}
    items = body.get("items", [])
    if isinstance(items, dict):
        items = items.get("item", [])
    if isinstance(items, dict):  # 1건이면 dict로 오는 경우
        items = [items]
    return items or [], _to_int(body.get("totalCount")) or 0


def _code(payload):
    header = payload.get("response", payload).get("header", {}) if isinstance(payload, dict) else {}
    return str(header.get("resultCode", "")), header.get("resultMsg", "")


def _fetch_pass(endpoint, key, size, prpt, sido, pvct):
    """(시도 × 수의계약여부) 1개 조합을 끝까지 조회. 반환: (records, complete)"""
    records, page, complete = [], 1, True
    while True:
        params = [("serviceKey", key), ("pageNo", page), ("numOfRows", size), ("resultType", "json"),
                  ("prptDivCd", prpt), ("pvctTrgtYn", pvct), ("lctnSdnm", sido)]
        url = endpoint + ("&" if "?" in endpoint else "?") + urllib.parse.urlencode(params)
        time.sleep(CALL_INTERVAL)
        try:
            payload = _parse(_request(url))
        except OnbidError:
            if page == 1:
                raise
            return records, False
        code, msg = _code(payload)
        if code == "03":              # NODATA_ERROR — 해당 조합에 물건이 없음(정상)
            break
        if code != "00":
            if page == 1:
                raise OnbidError(f"API 결과코드 {code}: {msg}")
            return records, False
        items, total = _items(payload)
        records.extend(items)
        if not items or page * size >= total:
            break
        page += 1
        if page > 300:                # 안전장치
            return records, False
    return records, complete


def fetch(ctx):
    raw_key = os.environ.get("ONBID_SERVICE_KEY", "").strip()
    if not raw_key:
        raise OnbidError("ONBID_SERVICE_KEY 환경변수가 필요합니다 (공공데이터포털 인증키)")
    key = _decode_key(raw_key)
    endpoint = os.environ.get("ONBID_ENDPOINT", "").strip() or DEFAULT_ENDPOINT
    size = int(os.environ.get("ONBID_PAGE_SIZE", "100"))
    prpt = os.environ.get("ONBID_PRPT_CODES", DEFAULT_PRPT)
    sidos = [s.strip() for s in os.environ.get("ONBID_SIDO", DEFAULT_SIDO).split(",") if s.strip()]

    merged, complete, errors, ok_passes = {}, True, [], 0
    for sido in sidos:
        for pvct in ("N", "Y"):  # 수의계약가능여부는 필수값이라 두 번 조회해 합친다
            try:
                recs, ok = _fetch_pass(endpoint, key, size, prpt, sido, pvct)
            except OnbidError as e:
                errors.append(f"{sido}/{pvct}: {e}")
                complete = False
                continue
            ok_passes += 1
            complete = complete and ok
            for rec in recs:
                norm = _normalize(rec)
                if norm:
                    merged[norm["mgmt_no"]] = norm
    if ok_passes == 0:
        raise OnbidError("; ".join(errors)[:500])
    results = [r for r in merged.values()
               if (r.get("sido") or "").startswith(("대구", "경북", "경상북"))]
    return results, complete
