import re, urllib.request, sys
u = "https://www.data.go.kr/data/15098181/fileData.do"
req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
h = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
print("len", len(h))
for pat in [r"atchFileId[^\n]{0,200}", r"fileDownload[^\n]{0,200}", r"fn_fileDataDown[^\n]{0,200}", r"uddi:[0-9a-f\-_]+", r"download[^\n]{0,160}"]:
    for m in list(dict.fromkeys(re.findall(pat, h)))[:8]: print(pat[:12], "|", m[:240])
