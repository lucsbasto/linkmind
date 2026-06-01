# Roadmap

**Current Milestone:** M1 — MVP Núcleo (Captura + Pesquisa)
**Status:** In Progress — M0 ✅ concluído (F0.1 + F0.2). Primeira feature do M1 em spec: **F1.2 fetch_web_content**.

---

## M0 — Fundação de Infraestrutura

**Goal:** Stack base instalada e capaz de ecoar uma mensagem do WhatsApp ao usuário via Claude Code, ponta a ponta.
**Target:** Pré-requisito de qualquer feature funcional.

### Features

**F0.1 — Setup Omni + Genie + pgserve local (com spike de descoberta)** - ✅ DONE (2026-06-01)

- Spike: clonar e ler código fonte de Omni/Genie para confirmar envelope NATS, subject de outbound e mecânica de registro de MCP/tools customizadas em TS/Bun
- Instalação documentada via scripts oficiais (`install.sh` Omni + `get.automagik.dev/genie`) + PM2 + pgserve
- Pareamento do WhatsApp via Baileys (QR code no terminal)
- Validação: mensagem texto enviada no WhatsApp aparece em log do Genie (consumer NATS) e resposta sintética volta ao usuário via Omni

**F0.2 — Esqueleto do agente + tool harness** - ✅ DONE (2026-06-01)

- Wiring `omni connect <instance> <agent>` para que mensagens cheguem ao agente
- Execução do agente via **`claude` CLI nativo (sonnet) spawnado pelo bridge** (correção do spike: NÃO via `@anthropic-ai/claude-agent-sdk` — ver `.specs/features/F0.2-agente-real-tools/discovery.md`)
- Tool harness em TS/Bun com 1 tool dummy (`mcp__hello__ping`) registrada via `.mcp.json` + `.claude/settings.local.json` (NÃO via `sdk.*` — o bridge ignora). Doc em `tools/README.md`
- System prompt inicial (sem hardening ainda)
- Validação: agente responde e chama tool dummy retornando valor visível no WhatsApp ✅

---

## M1 — MVP Núcleo (Captura + Pesquisa)

**Goal:** Usuário envia link/vídeo → recebe card Feynman. Usuário envia dúvida → recebe pílula curta + gatilho "pode mandar" e recupera texto denso sob comando.
**Target:** Critério de "shippable" — 3 usuários externos rodam local por 7 dias sem suporte.

### Features

**F1.1 — Detecção dinâmica de intenção** - PLANNED

- Classificador (LLM-based) que decide: LINK_PARA_ARQUIVAR | DUVIDA_PARA_PESQUISAR | OUTRO
- Roteamento da mensagem para o pipeline correto
- Critério: precisão ≥95% em conjunto de 50 mensagens-fixture

**F1.2 — Tool `fetch_web_content` (scraper universal)** - 🚧 IN PROGRESS (spec 2026-06-01)

- Extração de conteúdo central de páginas via Readability + jsdom
- Remoção de ads, menus, navegação
- Limites de tamanho + timeout

**F1.3 — Tool `get_youtube_transcript`** - PLANNED

- Extração de legendas (auto-geradas ou manuais)
- Detecção de idioma e fallback
- Tratamento de vídeos sem legenda

**F1.4 — Sumarização cognitiva Feynman** - PLANNED

- Prompt estruturado: Ideia Central, Pilares (Core Takeaways), Aplicação Prática
- Output em JSON validado antes de persistir
- Postura agnóstica de domínio (mesma qualidade para nutrição vs engenharia)

**F1.5 — Tool `save_knowledge_node` + schema Postgres** - PLANNED

- Migration de tabelas (knowledge_node, source, summary)
- Escrita transacional com tipo (LINK | YOUTUBE | RESEARCH)
- Índices para recuperação por usuário + data

**F1.6 — Tool `search_web_knowledge` (Brave Search API)** - PLANNED

- Wrapper sobre Brave Search API com chave em env
- Consolidação de top resultados em resumo Feynman
- Tratamento de rate limit + erros HTTP

**F1.7 — Gatilho async anti-textão** - PLANNED

- Resumo de pesquisa salvo em Postgres com status `PENDING_RELEASE`
- Notificação curta no WhatsApp: "Já pesquisei, é só pedir"
- Loop de release com `FOR UPDATE SKIP LOCKED` quando usuário envia gatilho ("pode mandar", "manda", etc.)

**F1.8 — Hardening do system prompt** - PLANNED

- Prompt blindado contra injection
- Recusa estruturada para pedidos fora do escopo PKM
- Bateria de testes de injection (≥20 ataques conhecidos)

**F1.9 — Docker Compose reproduzível + docs de setup** - PLANNED

- `docker-compose.yml` final com Postgres + tools service
- README com passo a passo de instalação Omni/Genie
- Script `make verify` que roda smoke test ponta a ponta

---

## M2 — Pós-MVP (planejado, fora do v1)

**Goal:** Tornar o cérebro realmente "segundo" — cruzamento automático de notas e combate ativo ao esquecimento.

### Features

**F2.1 — Cruzamento Zettelkasten automático** - PLANNED

- Embeddings de knowledge nodes
- Sugestão de conexões ao salvar nova nota
- Card de resposta com "isso conecta com..."

**F2.2 — Revisão espaçada proativa** - PLANNED

- Agendamento stateful no Postgres
- Disparo proativo via WhatsApp ("Faz 3 dias que você salvou X...")
- Resiliente a downtime (recuperação retroativa segura)

---

## Future Considerations

- Deploy em VPS para uso 24/7 por terceiros (necessário para tornar M2 realmente proativo)
- Múltiplos usuários no mesmo deployment (multi-tenancy)
- Re-introdução de áudio (Speech-to-Text) se persona pedir
- Re-introdução de agente consultor + integração com calendário se demanda surgir
