import re, urllib.request, urllib.parse, json, http.cookiejar
cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
H = {"User-Agent": "Mozilla/5.0", "Referer": "https://www.data.go.kr/data/15098181/fileData.do"}
def get(u, data=None):
    r = op.open(urllib.request.Request(u, data=data, headers=H), timeout=60); return r.read(), r.headers
h = get("https://www.data.go.kr/data/15098181/fileData.do")[0].decode("utf-8", "replace")
i = h.find("function fn_fileDataDown")
print("inline def at", i); print(h[i:i+2500] if i >= 0 else "")
for s in re.findall(r'<script[^>]+src="([^"]+)"', h):
    if "tcs" in s or "dss" in s or "file" in s.lower() or "common" in s.lower():
        try:
            js = get(urllib.parse.urljoin("https://www.data.go.kr/", s))[0].decode("utf-8", "replace")
            j = js.find("fn_fileDataDown")
            if j >= 0: print("JS", s); print(js[j:j+2500])
        except Exception as e: print("ERR", s, e)
