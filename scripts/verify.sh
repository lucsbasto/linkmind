#!/usr/bin/env bash
# scripts/verify.sh — smoke test ponta-a-ponta do LinkMind (F1.9).
#
# Ordem: barato → caro, falha alto (exit ≠0) se QUALQUER check obrigatório quebrar.
# Cada ✗ traz a ação corretiva (mapa erro→runbook). Sem efeitos colaterais permanentes
# (a linha de teste do smoke-pipeline é removida no fim).
#
# Uso:
#   scripts/verify.sh         # checks determinísticos (offline, sem quota/WhatsApp)
#   scripts/verify.sh --full  # + check real do Gemini (gasta ~quota e ~segundos)
#
# WhatsApp pareado e Gemini OAuth são tratados como AVISO no modo padrão (passos
# manuais frágeis); o `--full` torna o Gemini obrigatório.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env

FULL=0
[ "${1:-}" = "--full" ] && FULL=1

OMNI_INSTANCE="${LINKMIND_OMNI_INSTANCE:-05415247-c598-4a2b-832b-f127d4410e10}"
KNOWLEDGE_DIR="$REPO_ROOT/tools/knowledge"

step "Serviços base (PM2)"
for svc in omni-api omni-nats autopg-server; do
  if pm2 jlist 2>/dev/null | jq -e --arg n "$svc" \
       '.[] | select(.name==$n and .pm2_env.status=="online")' >/dev/null 2>&1; then
    ok "pm2: $svc online"; CHECKS_OK=$((CHECKS_OK + 1))
  else
    err "pm2: $svc NÃO online"; CHECKS_FAIL=$((CHECKS_FAIL + 1))
    hint "pós-reboot: pm2 resurrect   |   ver: pm2 ls"
  fi
done

step "Bridge (genie serve)"
# `genie serve status` é o sinal autoritativo (o pidfile guarda "pid:token" e pode ficar
# stale; pgrep casa invocações transitórias de `genie serve start`).
if genie serve status 2>/dev/null | grep -qi 'omni-bridge: running'; then
  ok "bridge + omni-bridge running"; CHECKS_OK=$((CHECKS_OK + 1))
else
  err "bridge fora do ar"; CHECKS_FAIL=$((CHECKS_FAIL + 1))
  hint "subir: genie serve start --daemon --headless"
fi

step "CLIs do agente"
if check "claude CLI presente" have claude; then :; else
  hint "instale o Claude Code CLI e faça login (claude)"
fi
if have gemini; then
  ok "gemini CLI presente"; CHECKS_OK=$((CHECKS_OK + 1))
else
  err "gemini CLI ausente"; CHECKS_FAIL=$((CHECKS_FAIL + 1))
  hint "instale o Gemini CLI e autentique (gemini — OAuth headless)"
fi

step "Postgres (pgserve) + schema + migrations"
SOCKET="${LINKMIND_PG_SOCKET:-${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/pgserve/.s.PGSQL.5432}"
if [ -S "$SOCKET" ]; then
  ok "socket pgserve presente"; CHECKS_OK=$((CHECKS_OK + 1))
else
  err "socket pgserve ausente ($SOCKET)"; CHECKS_FAIL=$((CHECKS_FAIL + 1))
  hint "pgserve no ar? pm2 ls | grep autopg-server"
fi
# Pipeline determinístico: INSERT→SELECT→jsonb round-trip→cleanup (prova migrations).
if (cd "$KNOWLEDGE_DIR" && bun run "$REPO_ROOT/scripts/smoke-pipeline.ts") 2>/tmp/linkmind-smoke.err; then
  ok "pipeline determinístico (DB + schema + migrations + jsonb)"; CHECKS_OK=$((CHECKS_OK + 1))
else
  err "pipeline determinístico falhou"; CHECKS_FAIL=$((CHECKS_FAIL + 1))
  hint "rode as migrations: make migrate   |   detalhe: $(tail -1 /tmp/linkmind-smoke.err 2>/dev/null)"
fi

step "WhatsApp (Omni) — informativo"
if have omni && omni instances whoami "$OMNI_INSTANCE" 2>/dev/null | grep -qi connected; then
  ok "instância WhatsApp connected"; CHECKS_OK=$((CHECKS_OK + 1))
else
  warn "WhatsApp não está 'connected' (passo manual: parear o QR — ver README)"
fi

step "Gemini headless${FULL:+ (--full)}"
if [ "$FULL" = "1" ]; then
  if echo "ok" | timeout 60 gemini -p "responda apenas: ok" >/dev/null 2>&1; then
    ok "gemini -p respondeu (OAuth válido)"; CHECKS_OK=$((CHECKS_OK + 1))
  else
    err "gemini -p falhou/timeout"; CHECKS_FAIL=$((CHECKS_FAIL + 1))
    hint "reautentique: gemini (OAuth headless) — creds em ~/.gemini/oauth_creds.json"
  fi
else
  warn "check real do Gemini pulado (rode 'make verify-full' p/ exercer o OAuth)"
fi

summary
