"""Release tooling for BBX Analyzer (for maintainers; users never need this).

    python tools/release.py check   # version consistency, docs up to date with the code, tests
    python tools/release.py docs    # regenerate screenshots, banner and the sample PDF report from the real app
    python tools/release.py zip     # build dist/bbx-analyzer-v<VERSION>.zip
    python tools/release.py all     # docs → check → zip: the one command before every release

Docs are part of the release: `check` fails when the code changed after the screenshots and sample report were made
(docs/.docs-stamp holds a fingerprint of the code they were made from), when README / CHANGELOG / launchers disagree
with version.py, or when a test fails. `docs` needs the dev requirements (playwright + its Chromium, see
requirements-dev.txt); the PDF page previews also use `pdftoppm` (poppler) when it is installed.
"""
import asyncio
import base64
import hashlib
import json
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
DOCS, IMG, DIST = ROOT / "docs", ROOT / "docs" / "img", ROOT / "dist"
DEMO_LOG = "BTFL_FAWKES_20260927_192610.BBL"       # the one log shipped in logs/ and used for every screenshot
DEMO_PROP = {"inch": 7, "blades": 2}
STAMP = DOCS / ".docs-stamp"
# what goes into the zip: everything except caches, private environments, dev notes and logs other than the demo one
EXCLUDE_DIRS = {".venv", ".tools", "__pycache__", ".pytest_cache", "dist", ".git", "node_modules"}
EXCLUDE_FILES = {"CONTEXT.md", ".write_test", "BBX Analyzer.desktop", "BBX Analyzer.lnk"}
EXCLUDE_SUFFIX = (".npz", ".model.json", ".sim.json", ".pyc")


def version():
    return re.search(r'VERSION\s*=\s*"([^"]+)"', (ROOT / "version.py").read_text()).group(1)


def code_fingerprint():
    """Hash of everything the screenshots and the report depend on (app code, styles, glossary, the demo log)."""
    h = hashlib.sha1()
    files = sorted(p for p in ROOT.glob("*.py")) + sorted((ROOT / "static").rglob("*.js")) + sorted((ROOT / "static").rglob("*.css")) \
        + [ROOT / "static" / "index.html", ROOT / "logs" / DEMO_LOG]
    for p in files:
        if p.exists() and "vendor" not in p.parts:
            h.update(p.name.encode()); h.update(p.read_bytes())
    return h.hexdigest()[:16]


# ---------------------------------------------------------------- check
def check(run_tests=True):
    v, major = version(), version().split(".")[0]
    problems = []
    readme = (ROOT / "README.md").read_text()
    if f"Current version: {v}" not in readme:
        problems.append(f"README.md doesn't say 'Current version: {v}'")
    cl = (ROOT / "CHANGELOG.md").read_text() if (ROOT / "CHANGELOG.md").exists() else ""
    if not re.search(rf"^## {re.escape(v)}\b", cl, re.M):
        problems.append(f"CHANGELOG.md has no '## {v}' entry")
    if f"<string>{v}</string>" not in (ROOT / "start.sh").read_text():
        problems.append(f"start.sh (macOS app plist) doesn't carry version {v}")
    for f in ("start.sh", "start.bat"):
        if f"v{major}" not in (ROOT / f).read_text():
            problems.append(f"{f} banner doesn't say v{major}")
    for img in re.findall(r"\(docs/img/([^)]+)\)", readme):
        if not (IMG / img).exists():
            problems.append(f"README shows docs/img/{img}, which doesn't exist")
    st = json.loads(STAMP.read_text()) if STAMP.exists() else {}
    if st.get("version") != v or st.get("code") != code_fingerprint():
        problems.append("screenshots / banner / sample report were made from older code: run  python tools/release.py docs")
    if run_tests:
        r = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests"], cwd=ROOT)
        if r.returncode:
            problems.append("tests failed")
    for p in problems:
        print("✗", p)
    print("✓ release checks passed" if not problems else f"{len(problems)} problem(s)")
    return not problems


# ---------------------------------------------------------------- docs (screenshots, banner, sample report)
def _free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def _server():
    port = _free_port()
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app:app", "--port", str(port), "--log-level", "warning"], cwd=ROOT)
    for _ in range(120):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/version", timeout=1); return proc, port
        except Exception:
            time.sleep(0.25)
    proc.kill(); raise RuntimeError("server didn't start")


GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]


async def shot_splash(pg):
    await pg.screenshot(path=str(IMG / "splash.png")); print("  ✓ splash.png")


async def _shots(port):
    from playwright.async_api import async_playwright
    base = f"http://127.0.0.1:{port}"
    craft = json.loads(urllib.request.urlopen(f"{base}/api/{DEMO_LOG}/1/meta").read())["headers"].get("Craft name", DEMO_LOG)
    IMG.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=GL_ARGS)          # software WebGL, so the 3D splash renders without a GPU
        pg = await b.new_page(viewport={"width": 1440, "height": 900}, color_scheme="dark", accept_downloads=True)
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        await pg.goto(base + "/"); await pg.wait_for_timeout(11000)       # the splash (no log open yet): the toy world, mid-flight
        await shot_splash(pg)
        await pg.evaluate("([k, v]) => { localStorage.clear(); localStorage.setItem(k, JSON.stringify(v)); }", [f"bbx.prop:{craft}", DEMO_PROP])
        await pg.select_option("#file", DEMO_LOG); await pg.wait_for_timeout(4000)

        async def tab(t):
            await pg.evaluate("t => document.querySelector('#tabs [data-tab=\"' + t + '\"]').click()", t)
            if t == "pidsim":
                try:
                    await pg.click("#sgOk", timeout=5000)
                except Exception:
                    pass
            for _ in range(200):
                await pg.wait_for_timeout(250)
                if await pg.is_hidden("#busy"):
                    break
            await pg.wait_for_timeout(900); await pg.mouse.move(2, 2); await pg.wait_for_timeout(200)

        async def hover_point(js_find):
            xy = await pg.evaluate(js_find)
            if xy:
                await pg.mouse.move(xy[0], xy[1]); await pg.wait_for_timeout(700)
            return xy
        shot = lambda name, **k: pg.screenshot(path=str(IMG / name), **({"quality": 85, "type": "jpeg"} if name.endswith(".jpg") else {}), **k)
        for t, name in (("summary", "summary.png"), ("plan", "plan.png"), ("tracking", "tracking.png"), ("noise", "noise.png"),
                        ("spectro", "spectrogram.jpg"), ("step", "step.png"), ("pidsim", "pidsim.png"), ("health", "health.png")):
            await tab(t); await shot(name); print("  ✓", name)
        el = await pg.query_selector("#hpwr")
        if el:
            await el.scroll_into_view_if_needed(); await pg.wait_for_timeout(400); await el.screenshot(path=str(IMG / "battery.png")); print("  ✓ battery.png")
        await tab("avatar"); await pg.wait_for_timeout(3500); await shot("avatar.png"); print("  ✓ avatar.png")
        # filter delay with the hover card on the stage that costs the most
        await tab("delay")
        await hover_point("""() => { const gd = document.getElementById('main'), bars = gd.data.map((t, k) => [t, k]).filter(([t]) => t.type === 'bar');
            let best = null; bars.forEach(([t], j) => { const cd = t.customdata && t.customdata[0]; if (cd && cd.startsWith('dly:y:') && (!best || t.x[0] > best[1])) best = [j, t.x[0]]; });
            if (!best) return null; const r = gd.querySelectorAll('.barlayer .trace')[best[0]].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }""")
        await shot("delay.png"); print("  ✓ delay.png")
        # propwash with a chop hovered (replay card)
        await tab("propwash")
        await hover_point("""() => { const gd = document.getElementById('main'); const k = gd.data.findIndex(t => t.mode && t.mode.includes('markers') && t.x && t.x.length);
            if (k < 0) return null; const t = gd.data[k], i = t.y.reduce((b, v, j) => v > t.y[b] ? j : b, 0), fl = gd._fullLayout;
            const xa = fl[(t.xaxis || 'x').replace('x', 'xaxis')], ya = fl[(t.yaxis || 'y').replace('y', 'yaxis')], r = gd.getBoundingClientRect();
            return [r.left + xa._offset + xa.l2p(t.x[i]), r.top + ya._offset + ya.l2p(t.y[i])]; }""")
        await pg.wait_for_timeout(1500); await shot("propwash.png"); print("  ✓ propwash.png")
        # the sample PDF report
        await tab("plan")
        async with pg.expect_download(timeout=300000) as d:
            await pg.evaluate("makeReport()")
        await (await d.value).save_as(str(DOCS / "sample-report.pdf")); print("  ✓ sample-report.pdf")
        if errors:
            print("  ! page errors:", errors[:5])
        await b.close()
    return errors


async def _banner():
    from playwright.async_api import async_playwright
    b64 = lambda p, mt: f"data:{mt};base64," + base64.b64encode(p.read_bytes()).decode()
    logo = (ROOT / "static" / "brand" / "logo.svg").read_text()
    html = f'''<html><head><style>
body{{margin:0;width:1280px;height:640px;background:#0c0e13;font-family:'DejaVu Sans',sans-serif;color:#e8ecf2;overflow:hidden;position:relative}}
.grid{{position:absolute;inset:0;background-image:linear-gradient(#ffffff08 1px,transparent 1px),linear-gradient(90deg,#ffffff08 1px,transparent 1px);background-size:40px 40px}}
.glow{{position:absolute;left:-200px;top:-200px;width:900px;height:900px;background:radial-gradient(circle,#3987e522,transparent 60%)}}
.left{{position:absolute;left:64px;top:90px;width:520px}} .left svg{{width:500px;height:auto;display:block}}
h1{{font-size:30px;line-height:1.25;margin:34px 0 18px;font-weight:700;letter-spacing:-.01em}} h1 b{{color:#ffb340}}
ul{{list-style:none;padding:0;margin:0;display:grid;gap:9px;font-size:17px;color:#b9c1cd}}
li::before{{content:"";display:inline-block;width:8px;height:8px;border-radius:2px;background:#3987e5;margin-right:12px;vertical-align:2px}}
.foot{{position:absolute;left:64px;bottom:40px;font-size:14px;color:#7d8696;letter-spacing:.06em}}
.shot{{position:absolute;border-radius:12px;box-shadow:0 20px 60px #000a,0 0 0 1px #ffffff1a;overflow:hidden}} .shot img{{display:block}}
.s1{{left:640px;top:60px;width:600px}} .s1 img{{width:600px}} .s2{{left:740px;top:330px;width:500px}} .s2 img{{width:500px}}
</style></head><body><div class="grid"></div><div class="glow"></div>
<div class="left">{logo}<h1>Betaflight blackbox logs,<br>turned into <b>answers</b>.</h1>
<ul><li>Noise, filters &amp; filter delay, explained</li><li>PID simulator learned from your own flight</li><li>Propwash replay on a 3D quad</li>
<li>Motor health, one tune plan, PDF report</li></ul></div>
<div class="foot">FREE · RUNS LOCALLY · WINDOWS · MACOS · LINUX · v{version()}</div>
<div class="shot s1"><img src="{b64(IMG / 'delay.png', 'image/png')}"></div>
<div class="shot s2"><img src="{b64(IMG / 'spectrogram.jpg', 'image/jpeg')}"></div></body></html>'''
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={"width": 1280, "height": 640})
        await pg.set_content(html); await pg.wait_for_timeout(500)
        await pg.screenshot(path=str(DOCS / "banner.png")); await b.close()
    print("  ✓ banner.png")


def _report_preview():
    """First pages of the sample report side by side (needs pdftoppm; skipped without it)."""
    if not shutil.which("pdftoppm"):
        print("  · pdftoppm not found: report preview image skipped"); return
    tmp = DIST / "_pages"; shutil.rmtree(tmp, ignore_errors=True); tmp.mkdir(parents=True)
    subprocess.run(["pdftoppm", "-r", "50", "-png", "-f", "1", "-l", "4", str(DOCS / "sample-report.pdf"), str(tmp / "p")], check=True,
                   stderr=subprocess.DEVNULL)
    from PIL import Image
    pages = [Image.open(f) for f in sorted(tmp.glob("p-*.png"))]
    w, h = pages[0].size; gap = 16
    out = Image.new("RGB", (len(pages) * (w + gap) + gap, h + 2 * gap), (12, 14, 19))
    for i, im in enumerate(pages):
        out.paste(im, (gap + i * (w + gap), gap))
    out.save(IMG / "report.png"); shutil.rmtree(tmp, ignore_errors=True)
    print("  ✓ report.png")


def docs():
    print("Regenerating docs from the app with", DEMO_LOG)
    proc, port = _server()
    try:
        errors = asyncio.run(_shots(port))
    finally:
        proc.terminate(); proc.wait(10)
    asyncio.run(_banner())
    _report_preview()
    STAMP.write_text(json.dumps({"version": version(), "code": code_fingerprint(), "made": time.strftime("%Y-%m-%d %H:%M")}, indent=1))
    if errors:
        print("✗ the app reported page errors while making the screenshots"); return False
    return True


# ---------------------------------------------------------------- zip
def zip_release():
    v = version(); DIST.mkdir(exist_ok=True)
    out = DIST / f"bbx-analyzer-v{v}.zip"
    n = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(ROOT.rglob("*")):
            rel = p.relative_to(ROOT)
            if any(part in EXCLUDE_DIRS for part in rel.parts) or p.name in EXCLUDE_FILES or p.name.endswith(EXCLUDE_SUFFIX):
                continue
            if rel.parts[0] == "logs" and p.is_file() and p.name != DEMO_LOG:
                continue
            if p.name.startswith("BBX Analyzer.app") or "BBX Analyzer.app" in rel.parts:
                continue
            z.write(p, Path("bbx-analyzer") / rel); n += p.is_file()
    print(f"✓ {out.relative_to(ROOT)}  ({n} files, {out.stat().st_size / 1e6:.1f} MB)")
    return out


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    if cmd == "check":
        sys.exit(0 if check() else 1)
    if cmd == "docs":
        sys.exit(0 if docs() else 1)
    if cmd == "zip":
        zip_release()
    elif cmd == "all":
        if not docs() or not check():
            sys.exit(1)
        zip_release()
    else:
        print(__doc__)
