#!/bin/sh
# Remove os LaunchAgents do Agentário (o painel e o quiosque param; os logs ficam).
set -u
for label in com.agentario.tv com.agentario.kiosk; do
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$label.plist"
done
echo "[kiosk] desinstalado. Logs (se houver) continuam em $HOME/Library/Logs/agentario."
