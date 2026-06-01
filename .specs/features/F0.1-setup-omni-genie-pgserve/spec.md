# F0.1 — Setup Omni + Genie + pgserve com agente stub

## Problem Statement

Sem a stack base (Omni + Genie + pgserve) instalada e um agente stub conectado, nenhuma feature do LinkMind pode ser testada — toda mensagem de WhatsApp morre antes de chegar ao agente. O spike de descoberta já confirmou o caminho de integração: registrar uma pasta de agente no Genie e usar `omni connect`, reaproveitando o `omni-bridge` + `ClaudeSdkOmniExecutor` que o Genie já fornece. Esta feature entrega o ping/pong ponta a ponta.

## Goals

- [ ] Mensagem texto enviada no WhatsApp pareado é respondida pelo agente stub (`"ping"` → `"pong"`) em ≤ 10s.
- [ ] Setup é reproduzível em ≤ 30 min por um terceiro técnico seguindo o `README.md`.

## Out of Scope

| Feature | Reason |
|---|---|
| Tools de produto (`fetch_web_content`, etc.) | F1.x |
| Lógica real do agente (sumarização, intenção, pesquisa) | F0.2 e F1.x |
| Hardening de prompt injection | F1.8 |
| Docker Compose para serviços próprios | F0.2 ou primeira F1 que precisar |
| Smoke test automatizado (`make verify`) | Deferido — teste manual basta para validar v1 |
| Script one-liner de instalação | Deferido — README detalhado é suficiente |

---

## User Stories

### P1: Stack instalada e supervisionada ⭐ MVP

**User Story:** Como operador, quero seguir o `README.md` e ter Omni, Genie e pgserve rodando supervisionados por PM2 em WSL2, para poder avançar para pareamento.

**Acceptance Criteria:**

1. WHEN o `README.md` é executado em WSL2 + Ubuntu limpo THEN `pm2 ls` mostra `omni`, `genie`, `pgserve` no status `online`.
2. WHEN `genie doctor` é executado THEN reporta pgserve acessível, NATS acessível e Anthropic API key configurada.
3. WHEN qualquer processo é reiniciado (`pm2 restart <name>`) THEN volta ao estado saudável sem perda de dados.

**Independent Test:** `pm2 ls` mostra 3 processos `online` em WSL limpo.

---

### P1: WhatsApp pareado e canal funcional ⭐ MVP

**User Story:** Como usuário, quero parear meu número WhatsApp dedicado uma única vez via QR code e ter o canal pronto.

**Acceptance Criteria:**

1. WHEN o operador roda os comandos do CLI Omni (`omni instances create` + `omni instances qr <id> --watch`) THEN um QR code é renderizado no terminal e a leitura resulta em status `connected` ≤ 60s.
2. WHEN o processo `omni` é reiniciado THEN o pareamento é preservado (sem novo QR).

**Independent Test:** Status `connected` confirmado via `omni instances list`.

---

### P1: Agente stub conectado e respondendo ⭐ MVP

**User Story:** Como usuário, quero mandar `"ping"` no WhatsApp e receber `"pong"`, para confirmar que o caminho Omni → Genie → Claude Agent SDK → Omni → Baileys funciona ponta a ponta.

**Acceptance Criteria:**

1. WHEN uma pasta de agente `linkmind-agent` é registrada (`genie agent register`) com system prompt mínimo ("responda 'pong' quando receber 'ping', caso contrário responda 'ack'") THEN o `omni connect <instance> linkmind-agent` associa a instância ao agente sem erro.
2. WHEN o usuário envia `"ping"` no WhatsApp pareado THEN ele recebe `"pong"` em ≤ 10s.
3. WHEN o usuário envia qualquer outra mensagem texto THEN ele recebe `"ack"` em ≤ 10s.
4. WHEN o Anthropic API key não está configurada THEN `genie doctor` falha explicitamente apontando essa causa.

**Independent Test:** Manda "ping" do celular pareado, recebe "pong" em ≤ 10s.

---

## Edge Cases

- WHEN pgserve já está rodando em outra porta THEN o setup detecta o conflito e o README explica como resolver.
- WHEN a chave do Anthropic não está configurada THEN `genie doctor` reporta isso explicitamente.
- WHEN o WhatsApp pareado é desconectado pelo app THEN o README cobre como re-parear.

---

## Requirement Traceability

| ID | Story | Status |
|---|---|---|
| F01-01 | P1 Stack | Pending |
| F01-02 | P1 Stack | Pending |
| F01-03 | P1 Stack | Pending |
| F01-04 | P1 WhatsApp | Pending |
| F01-05 | P1 WhatsApp | Pending |
| F01-06 | P1 Agente stub | Pending |
| F01-07 | P1 Agente stub | Pending |
| F01-08 | P1 Agente stub | Pending |
| F01-09 | P1 Agente stub | Pending |

**Coverage:** 9 total, 0 mapped to tasks.

---

## Success Criteria

- [ ] `"ping"` → `"pong"` em ≤ 10s do celular pareado.
- [ ] `README.md` permite a terceiro técnico chegar ao mesmo ponto em ≤ 30 min.
- [ ] Anthropic API key bloqueia explicitamente (sem mensagens crípticas) quando ausente.
