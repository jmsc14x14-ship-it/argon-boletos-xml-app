#!/usr/bin/env bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$DIR/index.html"
elif command -v open >/dev/null 2>&1; then
  open "$DIR/index.html"
else
  python3 -m webbrowser "file://$DIR/index.html"
fi
