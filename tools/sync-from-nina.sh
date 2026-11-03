#!/usr/bin/env sh
# Copy the RNBO export (and the matching rnbo.js) from a NINA checkout into
# this site, then rebuild the stylesheet.
#
#   tools/sync-from-nina.sh ../NINA_netNIMB
#
# The interface itself (js/app.js) is a hand-port of NINA's
# src/clients/player.js and is not copied automatically.
set -eu

NINA="${1:-../NINA_netNIMB}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$NINA/public/assets/rnbo_export/patch.export.json" ]; then
  echo "No RNBO export found in $NINA/public/assets/rnbo_export" >&2
  exit 1
fi

mkdir -p "$HERE/assets/rnbo_export" "$HERE/assets/rnbo"
cp "$NINA"/public/assets/rnbo_export/* "$HERE/assets/rnbo_export/"
cp -R "$NINA"/public/assets/rnbo/* "$HERE/assets/rnbo/"

VERSION=$(sed -n 's/.*"rnboversion": *"\([^"]*\)".*/\1/p' "$HERE/assets/rnbo_export/patch.export.json" | head -n 1)
echo "RNBO export synced (rnbo.js $VERSION)"
if [ ! -f "$HERE/assets/rnbo/$VERSION/rnbo.min.js" ]; then
  echo "warning: assets/rnbo/$VERSION/rnbo.min.js missing — the page will fall back to the Cycling '74 CDN" >&2
fi

npx --yes sass --no-source-map "$HERE/style/app.scss" "$HERE/style/app.css"
echo "style/app.css rebuilt"
