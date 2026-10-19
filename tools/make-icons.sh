#!/usr/bin/env bash
# Remakes the app icon's PNGs from public/icon.svg, with headless Chrome:
# icon-192.png, icon-512.png (Android, Chrome) and apple-touch-icon.png (iPhone).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for size in 192 512 180; do
  out="$ROOT/public/icon-$size.png"
  [ "$size" = 180 ] && out="$ROOT/public/apple-touch-icon.png"
  # Opening the SVG itself doesn't size it to the window; an <img> does.
  echo "<body style=margin:0><img src=\"file://$ROOT/public/icon.svg\" width=$size height=$size style=display:block>" >"$TMP/icon.html"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --window-size=$size,$size --screenshot="$out" "file://$TMP/icon.html" 2>/dev/null
  echo "$out"
done
