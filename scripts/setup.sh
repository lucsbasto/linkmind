#!/usr/bin/env bash
# scripts/setup.sh — instalação idempotente do LinkMind (F1.9).
#
# Automatiza o que É NOSSO e seguro re-rodar (deps das tools, migrations, registro do
# agente e do schedule). Os passos PESADOS/INTERATIVOS (instalar a stack base, login
# do claude, OAuth do gemini, pareamento do WhatsApp) são CHECADOS e INSTRUÍDOS, não
# executados às cegas — menos risco de quebrar numa máquina alheia.
#
# Re-rodável: detecta o que já existe e não duplica. `make setup` chama este script.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env

cd "$REPO_ROOT"

step "1/5 — Pré-requisitos do host"
MISSING=0
for b in bun node pm2 git jq; do
  if have "$b"; then ok "$b"; else err "$b ausente"; MISSING=1; fi
done
if [ "$MISSING" = "1" ]; then
  hint "instale o toolchain base (WSL2/Ubuntu): Bun, Node 22, PM2, git, jq"
  err "abortei: pré-requisitos de host faltando"; exit 1
fi

step "2/5 — Stack base (Omni / Genie / pgserve) — checagem"
for b in genie omni gemini claude; do
  if have "$b"; then
    ok "$b presente"
  else
    warn "$b ausente — passo MANUAL (não automatizo p/ não quebrar sua máquina):"
    case "$b" in
      genie) hint "curl -fsSL get.automagik.dev/genie | bash   (depois: genie setup --quick)";;
      omni)  hint "instale o Omni via install.sh oficial; confira pm2 ls (omni-api/omni-nats)";;
      gemini) hint "instale o Gemini CLI e rode 'gemini' uma vez p/ o OAuth headless";;
      claude) hint "instale o Claude Code CLI e rode 'claude' uma vez p/ logar";;
    esac
  fi
done

step "3/5 — Dependências das tools (bun install)"
for dir in tools/fetch-web-content tools/hello-mcp tools/knowledge; do
  if [ -f "$dir/package.json" ]; then
    info "bun install em $dir"
    if (cd "$dir" && bun install >/dev/null 2>&1); then ok "$dir"; else err "$dir falhou"; fi
  fi
done

step "4/5 — Migrations do banco (idempotente)"
if have bun; then
  if (cd tools/knowledge && bun run migrate.ts); then
    ok "migrations aplicadas"
  else
    err "migrations falharam"
    hint "pgserve no ar? socket em \$XDG_RUNTIME_DIR/pgserve/.s.PGSQL.5432 (pm2 ls | grep autopg-server)"
  fi
fi

step "5/5 — Agente + schedule de lembretes (idempotente)"
if have genie; then
  # Agente: registra só se ainda não aparecer na lista.
  if genie agent list 2>/dev/null | grep -q linkmind-agent; then
    ok "agente linkmind-agent já registrado"
  else
    info "registrando agente linkmind-agent"
    genie agent register linkmind-agent --model sonnet --dir agents/linkmind-agent \
      && ok "agente registrado" \
      || warn "falha ao registrar agente (rode manualmente se necessário)"
  fi
  # Schedule do nudge diário: cria só se não existir.
  if genie schedule list 2>/dev/null | grep -q linkmind-nudge; then
    ok "schedule linkmind-nudge já existe"
  else
    info "criando schedule linkmind-nudge (09:00 BRT)"
    genie schedule create linkmind-nudge \
      --command "$(command -v bun) run $REPO_ROOT/tools/knowledge/reminder.ts" \
      --every "0 9 * * *" --timezone America/Sao_Paulo \
      && ok "schedule criado" \
      || warn "falha ao criar schedule (rode manualmente se necessário)"
  fi
else
  warn "genie ausente — pule o registro do agente/schedule até instalar a stack base"
fi

step "Passos manuais restantes (não automatizáveis)"
log "  1. Login do Claude:    claude            (autentica o engine do agente)"
log "  2. OAuth do Gemini:    gemini            (uma vez; creds em ~/.gemini/oauth_creds.json)"
log "  3. Bridge no ar:       genie serve start --daemon --headless"
log "  4. Parear WhatsApp:    deixe a tela 'Conectar aparelho' aberta, gere UM QR e escaneie em <15s"
log "                         (conta nova pode bloquear por anti-abuso — ver README/Blockers)"
log ""
log "Depois: ${C_GREEN}make verify${C_RESET} p/ conferir tudo de pé."

summary
