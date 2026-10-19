#!/bin/sh
# Instala o Agentário para abrir sozinho no login (LaunchAgents do usuário, sem sudo):
#   com.agentario.tv     — painel (adaptador + interface, build de produção); reinicia se cair.
#   com.agentario.kiosk  — abre a /tv em modo quiosque quando o painel responder.
# Uso: scripts/install-kiosk.sh [--dry-run]
# Desfazer: scripts/uninstall-kiosk.sh
set -eu

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

REPO="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
LOG_DIR="$HOME/Library/Logs/agentario"
AGENTS_DIR="$HOME/Library/LaunchAgents"
OUT_DIR="$AGENTS_DIR"
if [ "$DRY_RUN" = 1 ]; then OUT_DIR="$(mktemp -d)"; fi

xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

write_plist() { # $1 label, $2 conteúdo de ProgramArguments, $3 extras
  cat > "$OUT_DIR/$1.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$1</string>
  <key>ProgramArguments</key>
  <array>
$2
  </array>
  <key>WorkingDirectory</key><string>$(xml_escape "$REPO")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(xml_escape "$(dirname "$NODE")"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$(xml_escape "$LOG_DIR/$1.out.log")</string>
  <key>StandardErrorPath</key><string>$(xml_escape "$LOG_DIR/$1.err.log")</string>
$3
</dict>
</plist>
PLIST
  plutil -lint "$OUT_DIR/$1.plist" >/dev/null
}

write_plist com.agentario.tv \
"    <string>$(xml_escape "$NODE")</string>
    <string>$(xml_escape "$REPO/scripts/tv.mjs")</string>
    <string>--prod</string>" \
"  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>"

write_plist com.agentario.kiosk \
"    <string>/bin/sh</string>
    <string>$(xml_escape "$REPO/scripts/kiosk.sh")</string>" \
""

if [ "$DRY_RUN" = 1 ]; then
  echo "[dry-run] plists gerados e validados em $OUT_DIR (nada instalado):"
  ls "$OUT_DIR"
  exit 0
fi

echo "[kiosk] build de produção…"
(cd "$REPO" && npm run build)
mkdir -p "$LOG_DIR"
for label in com.agentario.tv com.agentario.kiosk; do
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS_DIR/$label.plist"
done
echo "[kiosk] instalado. Logs em $LOG_DIR. Para desfazer: scripts/uninstall-kiosk.sh"
