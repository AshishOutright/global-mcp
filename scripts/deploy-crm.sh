#!/usr/bin/env bash
# Builds the LIVE version (talks to the GMCP PHP backend) and copies it into the
# CRM web root, served at https://<crm-host>/app/.
#   CRM_ROOT=/web/global-mcp/gmcp.outrightcrm.in npm run deploy:crm
set -euo pipefail
CRM_ROOT="${CRM_ROOT:-/web/global-mcp/gmcp.outrightcrm.in}"
TARGET="$CRM_ROOT/app"
[ -f "$CRM_ROOT/custom/gmcp/bootstrap.php" ] || { echo "GMCP backend not found in $CRM_ROOT" >&2; exit 1; }

VITE_GMCP_API_URL="/index.php?entryPoint=gmcp_api" npm run build

STAGE="$(mktemp -d "$CRM_ROOT/.app-deploy-XXXXXX")"
cp -r dist/. "$STAGE/"
cat > "$STAGE/.htaccess" <<'HT'
# GMCP React app (built by global-mcp-frontend/scripts/deploy-crm.sh)
DirectoryIndex index.html
<IfModule mod_headers.c>
  <FilesMatch "\.html$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
  <FilesMatch "\.(js|css)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
</IfModule>
HT
# swap in atomically so visitors never see a half-copied app
rm -rf "$TARGET.old"
[ -d "$TARGET" ] && mv "$TARGET" "$TARGET.old"
mv "$STAGE" "$TARGET"
chmod -R a+rX "$TARGET"
rm -rf "$TARGET.old"
echo "Deployed to $TARGET"
