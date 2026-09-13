#!/usr/bin/env bash
# 把 docs/diagram/architecture.html 渲染成 docs/media/architecture.png（两倍分辨率）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
  --force-device-scale-factor=2 --window-size=1600,720 --virtual-time-budget=6000 \
  --screenshot="$ROOT/docs/media/architecture.png" "file://$ROOT/docs/diagram/architecture.html" >/dev/null 2>&1
echo "已生成 docs/media/architecture.png"
