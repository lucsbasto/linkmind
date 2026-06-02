#!/usr/bin/env bash
# scripts/lib.sh — helpers compartilhados por setup.sh e verify.sh.
# Source-only: não executa nada por si. `source scripts/lib.sh`.

set -uo pipefail

# Raiz do repo (este arquivo vive em <repo>/scripts/).
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Cores (degradam pra vazio se não for TTY).
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'; C_DIM=$'\033[2m'
else
  C_RESET=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_DIM=""
fi

# Contadores globais de check (verify.sh lê no fim p/ decidir o exit code).
CHECKS_OK=0
CHECKS_FAIL=0
CHECKS_WARN=0

log()   { printf '%s\n' "$*"; }
info()  { printf '%s▸%s %s\n' "$C_BLUE" "$C_RESET" "$*"; }
ok()    { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn()  { printf '%s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; CHECKS_WARN=$((CHECKS_WARN + 1)); }
err()   { printf '%s✗%s %s\n' "$C_RED" "$C_RESET" "$*"; }
hint()  { printf '   %s↳ %s%s\n' "$C_DIM" "$*" "$C_RESET"; }
step()  { printf '\n%s== %s ==%s\n' "$C_BLUE" "$*" "$C_RESET"; }

# check <descrição> <comando...> — roda o comando; ✓ se exit 0, ✗ caso contrário.
# Em falha, quem chama costuma imprimir um hint logo abaixo.
check() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    ok "$desc"; CHECKS_OK=$((CHECKS_OK + 1)); return 0
  else
    err "$desc"; CHECKS_FAIL=$((CHECKS_FAIL + 1)); return 1
  fi
}

# have <bin> — true se o binário está no PATH.
have() { command -v "$1" >/dev/null 2>&1; }

# Resumo final + exit code (0 só se nenhum ✗).
summary() {
  printf '\n%s—%s %d ok · %d falha · %d aviso\n' \
    "$C_DIM" "$C_RESET" "$CHECKS_OK" "$CHECKS_FAIL" "$CHECKS_WARN"
  [ "$CHECKS_FAIL" -eq 0 ]
}

# Carrega .env do repo se existir (não falha se ausente; defaults vivem no código).
load_env() {
  if [ -f "$REPO_ROOT/.env" ]; then
    set -a; # shellcheck disable=SC1091
    . "$REPO_ROOT/.env"; set +a
  fi
}
