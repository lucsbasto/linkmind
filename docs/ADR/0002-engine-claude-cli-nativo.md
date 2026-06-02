# ADR 0002 — Engine do agente = `claude` CLI nativo (não o Agent SDK)

**Status:** Aceito (2026-06-01) — reverteu a conclusão do spike inicial
**Contexto da feature:** F0.2 (esqueleto do agente + tool harness)

## Contexto

A premissa inicial (PRD seção 4.0) era que o agente rodaria via
`@anthropic-ai/claude-agent-sdk`, com tools registradas como `sdk.mcpServers` no
`agent.yaml` (caminho `genie dir edit --sdk-mcp-server`). O smoke test em **print-mode**
(`claude -p --mcp-config <json>`) confirmou esse caminho — **falso positivo**.

Ao testar pelo caminho real do bridge WhatsApp (P1 da F0.2), descobrimos que o
**genie-omni-bridge spawna o `claude` CLI nativo** com:

```
claude --permission-mode auto --resume <session> --settings <inline> --append-system-prompt-file <AGENTS.md>
```

— **sem** `--mcp-config` nem `--allowedTools`. Logo `sdk.mcpServers`/`sdk.allowedTools`
do `agent.yaml` são **ignorados** nesse caminho. Evidência completa em
`.specs/features/F0.2-agente-real-tools/discovery.md`.

## Decisão

O **engine é o `claude` CLI nativo** spawnado pelo bridge, com sessão mantida por
`--resume <sessionId>` e system prompt via `--append-system-prompt-file`. As tools NÃO
entram pelo SDK (ver [ADR 0003](0003-tools-mcp-stdio-efemeras.md)). O bloco `sdk.*` do
`agent.yaml` foi removido por ser inerte/enganoso.

## Consequências

- ✅ O caminho do bridge é a fonte de verdade — testes E2E batem com produção.
- ✅ Continuidade conversacional vem de graça (`--resume`), ver F1.11.
- ✅ Auth = login do `claude` CLI (não `ANTHROPIC_API_KEY`) — o agente responde mesmo sem a key no env.
- ⚠️ `genie agent observe` não reflete tool events (view não plugada) → verificar por `genie agent log` (`[C] mcp__...`).
- ⚠️ Mudanças em `.mcp.json`/`server.ts`/`AGENTS.md` só valem no próximo spawn; turno em voo cacheia → às vezes é preciso matar órfão `pkill -f 'claude.*linkmind-agent'`.

## Alternativas consideradas

- **Forçar o Agent SDK** (print-mode `claude -p --mcp-config`): não é o caminho do bridge; exigiria reescrever a integração Genie↔Omni. Descartado.
