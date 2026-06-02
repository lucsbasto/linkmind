# LinkMind — Makefile (F1.9). Orquestra setup, operação e verificação.
# `make` sem alvo mostra a ajuda. Os scripts pesados vivem em scripts/.

SHELL    := /bin/bash
ROOT     := $(shell pwd)
GENIE_PID := $(HOME)/.genie/serve.pid

.DEFAULT_GOAL := help
.PHONY: help setup start stop status migrate verify verify-full test

help: ## Mostra esta ajuda
	@echo "LinkMind — alvos disponíveis:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | sort | awk 'BEGIN {FS = ":.*?## "} {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

setup: ## Instalação idempotente (deps, migrations, agente, schedule)
	@bash scripts/setup.sh

start: ## Sobe a stack: pm2 resurrect + bridge (genie serve)
	@pm2 resurrect || true
	@genie serve start --daemon --headless

stop: ## Para o bridge (a stack base PM2 fica de pé)
	@genie serve stop || echo "bridge já parado"

status: ## Health de cada peça (pm2, bridge, WhatsApp)
	@echo "== PM2 =="; pm2 ls 2>/dev/null || echo "pm2 indisponível"
	@echo "== Bridge =="; \
	  if genie serve status 2>/dev/null | grep -qi 'omni-bridge: running'; then \
	    echo "  running"; else echo "  FORA — make start"; fi

migrate: ## Aplica as migrations do banco (idempotente)
	@cd tools/knowledge && bun run migrate.ts

verify: ## Smoke test determinístico (offline, sem quota/WhatsApp)
	@bash scripts/verify.sh

verify-full: ## verify + check real do Gemini (gasta quota)
	@bash scripts/verify.sh --full

test: ## Roda a suíte bun test da tool knowledge
	@cd tools/knowledge && bun test
