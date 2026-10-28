"""한전 여유용량만 조회(매시간). 이미 수집된 docs/data.json을 사용."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kepco
DOCS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs")
key = os.environ.get("KEPCO_API_KEY", "").strip()
items = json.load(open(os.path.join(DOCS, "data.json"), encoding="utf-8")).get("items", [])
kepco.run(items, os.path.join(DOCS, "kepco.json"), key, scrub=lambda t: str(t).replace(key, "***") if key else str(t))
