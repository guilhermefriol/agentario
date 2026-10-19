#!/bin/sh
# Instala o Agentário para subir sozinho no login (LaunchAgents do usuário, sem sudo):
#   com.agentario.tv     — painel (adaptador + interface, build de produção); reinicia se cair.
#   com.agentario.kiosk  — só com --kiosk: abre a /tv em tela cheia num navegador Chromium.
# Sem --kiosk, abra http://localhost:3210/tv no navegador que quiser.
# Uso: scripts/install-kiosk.sh [--kiosk] [--dry-run]
# Desfazer: scripts/uninstall-kiosk.sh
set -eu

DRY_RUN=0
KIOSK=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --kiosk) KIOSK=1 ;;
    *) echo "opção desconhecida: $arg" >&2; exit 2 ;;
  esac
done
LABELS="com.agentario.tv"
[ "$KIOSK" = 1 ] && LABELS="$LABELS com.agentario.kiosk"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
LOG_DIR="$HOME/Library/Logs/agentario"
AGENTS_DIR="$HOME/Library/LaunchAgents"
OUT_DIR="$AGENTS_DIR"
if [ "$DRY_RUN" = 1 ]; then OUT_DIR="$(mktemp -d)"; fi

xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

write_plist() { # $1 label, $2 conteúdo de ProgramArguments, $3 extras
  # Backup de um LaunchAgent anterior com o mesmo nome, antes de sobrescrever.
  if [ "$DRY_RUN" = 0 ] && [ -f "$OUT_DIR/$1.plist" ]; then cp "$OUT_DIR/$1.plist" "$OUT_DIR/$1.plist.bak"; fi
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

if [ "$KIOSK" = 1 ]; then
  write_plist com.agentario.kiosk \
"    <string>/bin/sh</string>
    <string>$(xml_escape "$REPO/scripts/kiosk.sh")</string>" \
""
fi

if [ "$DRY_RUN" = 1 ]; then
  echo "[dry-run] plists gerados e validados em $OUT_DIR (nada instalado):"
  ls "$OUT_DIR"
  exit 0
fi

echo "[kiosk] build de produção…"
(cd "$REPO" && npm run build)
mkdir -p "$LOG_DIR"
for label in $LABELS; do
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS_DIR/$label.plist"
done
echo "[kiosk] instalado. Logs em $LOG_DIR. Para desfazer: scripts/uninstall-kiosk.sh"
