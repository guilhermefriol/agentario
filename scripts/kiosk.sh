#!/bin/sh
# Abre a tela /tv em modo quiosque (tela cheia, sem barras) assim que o painel responder.
# Usa um perfil separado do navegador, para não mexer no perfil do dia a dia.
URL="${AGENTARIO_URL:-http://localhost:3210/tv}"
PROFILE="$HOME/Library/Application Support/agentario-kiosk"

i=0
until curl -fsS -o /dev/null "$URL"; do
  i=$((i + 1))
  if [ "$i" -ge 150 ]; then
    echo "[kiosk] painel não respondeu em $URL" >&2
    exit 1
  fi
  sleep 2
done

for app in "Google Chrome" "Chromium" "Brave Browser" "Microsoft Edge"; do
  if [ -d "/Applications/$app.app" ] || [ -d "$HOME/Applications/$app.app" ]; then
    exec open -na "$app" --args --kiosk --app="$URL" --user-data-dir="$PROFILE" \
      --noerrdialogs --disable-session-crashed-bubble --no-first-run --disable-infobars
  fi
done

echo "[kiosk] nenhum navegador Chromium encontrado (instale o Google Chrome)." >&2
exit 1
