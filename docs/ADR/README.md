# Architecture Decision Records (ADRs)

Decisões arquiteturais do LinkMind, com o **contexto e o porquê** — em especial as que
reverteram premissas iniciais durante o desenvolvimento. Formato de cada ADR:
**contexto → decisão → consequências/trade-offs → status**.

Fonte: estas decisões foram tomadas e registradas ao longo do M0/M1 (ver
`.specs/project/STATE.md` seção *Decisions* e os `discovery.md` de cada feature); os
ADRs as consolidam num formato navegável.

| # | Decisão | Status |
|---|---|---|
| [0001](0001-sem-docker-compose.md) | Sem Docker Compose — reprodutibilidade via `setup.sh` + `Makefile` + `make verify` | Aceito |
| [0002](0002-engine-claude-cli-nativo.md) | Engine do agente = `claude` CLI nativo (não Agent SDK) | Aceito (reverteu spike) |
| [0003](0003-tools-mcp-stdio-efemeras.md) | Tools = MCP servers stdio efêmeros via `.mcp.json` | Aceito |
| [0004](0004-resumo-via-gemini-cli.md) | Resumo/Q&A = Gemini CLI (separado do modelo de conversa) | Aceito |
| [0005](0005-persistencia-pgserve-socket-trust.md) | Persistência = pgserve por socket unix `trust` | Aceito |
| [0006](0006-host-wsl2-ubuntu.md) | Host runtime = WSL2 + Ubuntu | Aceito |

## Convenção

- Numeração sequencial `NNNN-titulo-kebab.md`.
- Um ADR é **imutável** depois de aceito; se a decisão mudar, escreve-se um novo ADR
  que **supersede** o anterior (e o antigo vira `Status: Superseded by NNNN`).
