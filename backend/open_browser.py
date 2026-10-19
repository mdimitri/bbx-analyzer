"""Used by the launchers: wait until BBX Analyzer answers, then open it in the default browser."""
import sys
import time
import urllib.request
import webbrowser

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
for _ in range(240):            # up to ~60 s (first start after an update can take a moment)
    try:
        urllib.request.urlopen(url + "/api/logs", timeout=1)
        break
    except Exception:
        time.sleep(0.25)
webbrowser.open(url)
