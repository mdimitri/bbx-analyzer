#!/usr/bin/env bash
# BBX Analyzer launcher for macOS and Linux.
#   macOS: double-click start.command      Linux: double-click start.sh (or run: bash start.sh)
# First run sets everything up inside this folder (.venv, .tools); later runs start in a few seconds.
# Works with bash 3.2 (macOS default). Nothing is installed system-wide.

cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"
PORT="${PORT:-8000}"
OS="$(uname -s)"

say()  { printf '%s\n' "$*"; }
T0=$(date +%s)
step() { say ""; say "[$1/4] $2"; }
elapsed() { say "      done in $(( $(date +%s) - T0 )) s since start"; }
fail() {
  say ""; say "!! $*"
  say "   If you are stuck, open an issue on GitHub and paste the lines above."
  if [ -t 0 ]; then say ""; printf 'Press Enter to close this window... '; read -r _; fi
  exit 1
}

say ""
say "  bbx analyzer v2  -  Betaflight blackbox logs, turned into answers"
say "  ------------------------------------------------------------"

# A copy inside a zip viewer or a read-only place can't hold the environment.
if ! ( : > .write_test ) 2>/dev/null; then
  fail "This folder is read-only. Unzip BBX Analyzer to a normal folder (e.g. your Documents) and run it from there."
fi
rm -f .write_test

# macOS: a downloaded folder is 'quarantined'. Now that you have chosen to run this once, clear it so the
# BBX Analyzer app created below (and later runs) open without warnings.
if [ "$OS" = "Darwin" ]; then xattr -dr com.apple.quarantine "$HERE" 2>/dev/null || true; fi

# ---------------------------------------------------------------- 1. a suitable Python (3.10 - 3.13)
step 1 "Looking for Python 3.10-3.13 (and the private environment in .venv)..."
# Newest Python releases sometimes lack ready-made packages for a few weeks, so known-good versions are preferred.
ok_py() {  # usage: ok_py <command>  -> 0 if it runs and is 3.10..3.13
  "$1" -c 'import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 13) else 1)' >/dev/null 2>&1
}
PY=""
if [ -x .venv/bin/python ] && ok_py .venv/bin/python; then
  PY=".venv/bin/python"
else
  for c in python3.13 python3.12 python3.11 python3.10 python3 python; do
    command -v "$c" >/dev/null 2>&1 || continue
    p="$(command -v "$c")"
    # macOS ships a /usr/bin/python3 stub that pops up an installer dialog when the developer tools are missing
    if [ "$OS" = "Darwin" ] && [ "$p" = "/usr/bin/python3" ] && ! xcode-select -p >/dev/null 2>&1; then continue; fi
    if ok_py "$p"; then PY="$p"; break; fi
  done
fi

if [ -n "$PY" ]; then say "      found: $PY ($("$PY" -V 2>&1))"; else say "      no suitable Python on this computer (a private copy will be downloaded)"; fi
UV=""
get_uv() {  # private copy of 'uv' (a tiny Python manager) in ./.tools; it downloads Python 3.12 into ./.tools too
  if [ -x .tools/uv ]; then UV="$HERE/.tools/uv"; return 0; fi
  say "> No suitable Python found: downloading a private Python 3.12 into this folder (one time, ~40 MB)..."
  mkdir -p .tools
  say "      downloading the 'uv' Python manager from astral.sh..."
  if command -v curl >/dev/null 2>&1; then
    curl -LSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="$HERE/.tools" UV_NO_MODIFY_PATH=1 INSTALLER_NO_MODIFY_PATH=1 sh || return 1
  elif command -v wget >/dev/null 2>&1; then
    wget -O- https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="$HERE/.tools" UV_NO_MODIFY_PATH=1 INSTALLER_NO_MODIFY_PATH=1 sh || return 1
  else
    return 1
  fi
  [ -x .tools/uv ] || { f="$(find .tools -name uv -type f 2>/dev/null | head -n 1)"; [ -n "$f" ] && mv "$f" .tools/uv; }
  [ -x .tools/uv ] && UV="$HERE/.tools/uv"
}

# ---------------------------------------------------------------- 2. private environment in ./.venv
make_venv_uv() {
  get_uv || fail "Could not download Python. Check your internet connection, or install Python 3.12 from https://www.python.org/downloads/ and run this again."
  rm -rf .venv
  say "      downloading Python 3.12 and creating .venv (progress below)..."
  UV_PYTHON_INSTALL_DIR="$HERE/.tools/python" UV_CACHE_DIR="$HERE/.tools/cache" "$UV" venv --seed --python 3.12 .venv \
    || fail "Could not set up the private Python."
}
if [ ! -x .venv/bin/python ] || ! ok_py .venv/bin/python; then
  rm -rf .venv
  if [ -n "$PY" ]; then
    say "      first run: creating the private environment .venv (1-3 minutes in total, needs internet once)..."
    if ! "$PY" -m venv .venv 2>&1 | sed 's/^/      /'; then
      rm -rf .venv
      say "  (this Python can't create environments, e.g. Debian/Ubuntu without python3-venv; using a private Python instead)"
      make_venv_uv
    fi
  else
    make_venv_uv
  fi
fi
VPY="$HERE/.venv/bin/python"
say "      environment ready: $("$VPY" -V 2>&1) in .venv"

# ---------------------------------------------------------------- 3. packages (only when requirements.txt changed)
install_pkgs() {
  say "      (a) updating pip"
  "$VPY" -m pip install --disable-pip-version-check -q --upgrade pip 2>&1 | sed 's/^/          /'
  say "      (b) web server and maths: $(grep -v '^#' requirements.txt | grep -v '^$' | sed 's/[<>=].*//' | tr '\n' ' ')"
  "$VPY" -m pip install --disable-pip-version-check --progress-bar off -r requirements.txt 2>&1 | sed 's/^/          /'
  [ "${PIPESTATUS[0]}" = 0 ] || return 1
  # orangebox (the .BBL decoder): its wheel has an entry point modern pip rejects, so unpack it directly
  say "      (c) orangebox, the .BBL decoder (downloaded and unpacked directly)"
  rm -rf .venv/dl
  "$VPY" -m pip download --disable-pip-version-check --progress-bar off --no-deps "orangebox==0.5.0" -d .venv/dl 2>&1 | sed 's/^/          /'
  [ "${PIPESTATUS[0]}" = 0 ] || return 1
  "$VPY" -c "import zipfile,glob,sysconfig; zipfile.ZipFile(glob.glob('.venv/dl/orangebox-*.whl')[0]).extractall(sysconfig.get_paths()['purelib'])" || return 1
  say "      (d) checking that everything imports"
  "$VPY" -c "import fastapi, uvicorn, numpy, multipart, orangebox; print('          ok: fastapi', fastapi.__version__, '| numpy', numpy.__version__)" || return 1
  # optional: numba compiles the simulator's inner loops (learning a quad's dynamics ~3-5x faster); fine without it
  say "      (e) optional speed-up 'numba' (the simulator runs 3-5x faster with it; skipped quietly if unavailable)"
  "$VPY" -m pip install --disable-pip-version-check --progress-bar off "numba>=0.59" 2>&1 | sed 's/^/          /'
  [ "${PIPESTATUS[0]}" = 0 ] || say "      (numba isn't available for this Python: analyses run a bit slower)"
  return 0
}
if ! cmp -s requirements.txt .venv/.installed 2>/dev/null; then
  step 2 "Installing the analysis packages (only on the first run or after an update)..."
  if ! install_pkgs; then
    if [ -z "$UV" ]; then
      say "  Package install failed with this Python; retrying with a private Python 3.12..."
      make_venv_uv; VPY="$HERE/.venv/bin/python"
      install_pkgs || fail "Installing packages failed. Check your internet connection and run this again."
    else
      fail "Installing packages failed. Check your internet connection and run this again."
    fi
  fi
  cp requirements.txt .venv/.installed
else
  step 2 "Analysis packages: already installed."
fi

# ---------------------------------------------------------------- 4. app shortcut with the BBX icon (once)
if [ ! -e .venv/.shortcut ]; then
  step 3 "Creating the 'BBX Analyzer' launcher with its icon (one time)..."
  if [ "$OS" = "Darwin" ]; then
    APP="$HERE/BBX Analyzer.app"
    mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
    cp static/brand/bbx.icns "$APP/Contents/Resources/bbx.icns" 2>/dev/null
    cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>BBX Analyzer</string>
  <key>CFBundleDisplayName</key><string>BBX Analyzer</string>
  <key>CFBundleIdentifier</key><string>org.bbx-analyzer.launcher</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIconFile</key><string>bbx</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>2.8.0</string>
  <key>LSMinimumSystemVersion</key><string>10.13</string>
</dict></plist>
PLIST
    cat > "$APP/Contents/MacOS/launcher" <<'LAUNCH'
#!/bin/bash
# opens the BBX Analyzer launcher in Terminal (the window shows progress; close it to stop BBX)
DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
open -a Terminal "$DIR/start.command"
LAUNCH
    chmod +x "$APP/Contents/MacOS/launcher"
    touch "$APP"
    say "> Created 'BBX Analyzer' (app with icon) in this folder: drag it to your Dock for one-click starts."
  elif [ -d "$HOME/.local/share/applications" ] || mkdir -p "$HOME/.local/share/applications" 2>/dev/null; then
    DESK="$HOME/.local/share/applications/bbx-analyzer.desktop"
    cat > "$DESK" <<DESKTOP
[Desktop Entry]
Type=Application
Name=BBX Analyzer
Comment=Betaflight blackbox log analysis
Exec=bash "$HERE/start.sh"
Icon=$HERE/static/brand/icon-512.png
Terminal=true
Categories=Science;Engineering;
DESKTOP
    chmod +x "$DESK" 2>/dev/null
    cp "$DESK" "$HERE/BBX Analyzer.desktop" 2>/dev/null && chmod +x "$HERE/BBX Analyzer.desktop" 2>/dev/null
    say "> Added 'BBX Analyzer' to your applications menu."
  fi
  touch .venv/.shortcut
fi

elapsed
step 4 "Starting BBX Analyzer (the first start compiles a few helpers; later starts take a few seconds)..."
# ---------------------------------------------------------------- 5. start the server and open the browser
while "$VPY" -c "import socket,sys; s=socket.socket(); sys.exit(s.connect_ex(('127.0.0.1',$PORT))!=0)" 2>/dev/null; do PORT=$((PORT + 1)); done
URL="http://127.0.0.1:$PORT"
"$VPY" -m uvicorn app:app --app-dir backend --host 127.0.0.1 --port "$PORT" --log-level warning &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT INT TERM HUP
up=0
for _ in $(seq 1 80); do
  if "$VPY" -c "import urllib.request; urllib.request.urlopen('$URL/api/logs', timeout=1)" >/dev/null 2>&1; then up=1; break; fi
  kill -0 $SERVER 2>/dev/null || break
  sleep 0.25
done
[ "$up" = 1 ] || fail "BBX did not start (see the message above)."
say ""
say "  BBX Analyzer is running:  $URL"
say "  Your browser should open by itself; if not, copy the address above into it."
say "  Keep this window open while you use it. Close it (or press Ctrl+C) to stop."
say ""
if [ "$OS" = "Darwin" ]; then open "$URL" >/dev/null 2>&1 || true
else xdg-open "$URL" >/dev/null 2>&1 || "$VPY" -m webbrowser "$URL" >/dev/null 2>&1 || true; fi
wait $SERVER
