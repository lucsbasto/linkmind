#!/usr/bin/env bash
#
# LinkMind — wrapper do bridge do Genie para rodar sob PM2.
#
# Por que existe:
#   - PM2 supervisiona melhor um processo em FOREGROUND (--daemon sob PM2 causa
#     loop de restart, porque o genie forka e o pai sai → PM2 pensa que crashou).
#   - O `genie serve` usa um pidfile com O_EXCL; se um restart deixar um pidfile
#     órfão, o próximo start morre. Limpamos o pidfile ANTES de subir.
#   - O bridge spawna tools/omni com um PATH enxuto; fixamos o PATH aqui para que
#     `bun`/`omni`/`genie` resolvam mesmo num boot limpo (PM2 via systemd).
set -euo pipefail

export PATH="$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin"

# Remove pidfile órfão de uma execução anterior (idempotente).
rm -f "$HOME/.genie/serve.pid"

# Foreground: o PM2 é quem daemoniza/supervisiona. --headless = só serviços
# (pgserve/scheduler/inbox-watcher), sem TUI. --no-interactive/--no-tui evitam
# qualquer prompt num contexto sem terminal.
exec genie serve start --foreground --headless --no-interactive --no-tui
