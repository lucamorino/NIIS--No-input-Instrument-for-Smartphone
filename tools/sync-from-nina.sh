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

# The export the NINA player loads — keep in step with PATCH_EXPORT_URL in js/app.js
EXPORT="${EXPORT:-NINA.export.json}"
SRC="$NINA/public/assets/rnbo_export"
DST="$HERE/assets/rnbo_export"

if [ ! -f "$SRC/$EXPORT" ]; then
  echo "No $EXPORT found in $SRC" >&2
  exit 1
fi

# Replace the export (only the files, not NINA's backup folder)
mkdir -p "$DST"
find "$DST" -maxdepth 1 -type f -name '*.export.*' -exec rm -f {} +
cp "$SRC/$EXPORT" "$DST/"
LICENSE="$SRC/${EXPORT%.json}.license"
[ -f "$LICENSE" ] && cp "$LICENSE" "$DST/"
[ -f "$SRC/dependencies.json" ] && cp "$SRC/dependencies.json" "$DST/"

# Ship only the rnbo.js the export was made with
VERSION=$(sed -n 's/.*"rnboversion": *"\([^"]*\)".*/\1/p' "$DST/$EXPORT" | head -n 1)
if [ -f "$NINA/public/assets/rnbo/$VERSION/rnbo.min.js" ]; then
  mkdir -p "$HERE/assets/rnbo/$VERSION"
  cp "$NINA/public/assets/rnbo/$VERSION/rnbo.min.js" "$HERE/assets/rnbo/$VERSION/"
  find "$HERE/assets/rnbo" -mindepth 1 -maxdepth 1 -type d ! -name "$VERSION" -exec rm -r {} +
else
  echo "warning: NINA has no rnbo.js $VERSION — the page will fall back to the Cycling '74 CDN" >&2
fi
echo "RNBO export synced: $EXPORT (rnbo.js $VERSION)"

npx --yes sass --no-source-map "$HERE/style/app.scss" "$HERE/style/app.css"
echo "style/app.css rebuilt"
