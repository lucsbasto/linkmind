# Roadmap

**Current Milestone:** M1 — MVP Núcleo (Captura + Pesquisa)
**Status:** In Progress — M0 ✅ concluído (F0.1 + F0.2). M1: **F1.2 fetch_web_content ✅ DONE (E2E validado 2026-06-01)**. Próxima feature a definir.

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

**F1.1 — Detecção dinâmica de intenção** - 📝 SPEC (2026-06-02)

- Classificador (LLM-based) que decide: LINK_PARA_ARQUIVAR | DUVIDA_PARA_PESQUISAR | OUTRO
- Roteamento da mensagem para o pipeline correto
- Critério: precisão ≥95% em conjunto de 50 mensagens-fixture
- ⚠️ Decisão na spec: formalizar+medir o roteamento que JÁ existe no AGENTS.md (vs. classificador pré-turno separado). 7 intenções + harness de eval.
- Spec: `.specs/features/F1.1-deteccao-intencao/spec.md`

**F1.2 — Tool `fetch_web_content` (scraper universal)** - ✅ DONE (2026-06-01)

- Extração de conteúdo central de páginas via `linkedom` (parser escolhido no P0; Readability/jsdom não usados)
- Remoção de ads, menus, navegação; tratamento de erros (404/PDF/URL inválida) com `ok:false`
- Registrada como server `web` no `.mcp.json` + auto-aprovada; E2E pelo WhatsApp validado

**F1.3 — Tool `get_youtube_transcript`** - 📝 SPEC (2026-06-02)

- Extração de legendas (auto-geradas ou manuais)
- Detecção de idioma e fallback
- Tratamento de vídeos sem legenda
- ⚠️ Spike de lib (P0): `youtube-transcript` vs `youtubei.js` sob Bun/Linux. Encaixa no pipeline existente via roteamento por host no worker (sem nova tool exposta).
- Spec: `.specs/features/F1.3-youtube-transcript/spec.md`

**F1.4 — Resumo Feynman (Gemini CLI) + persistência (escrita)** - 📝 SPEC (2026-06-01)

- Prompt estruturado: Ideia Central, Pilares (Core Takeaways), Aplicação Prática — JSON validado
- **Motor = Gemini CLI** (shell-out headless), não o modelo do agente
- Funde com slice de escrita da F1.5: tool `archive_link(url)` (captura→resume→salva) + tabela mínima `knowledge_node`
- Recuperação por tópico ("me envia o link de tal assunto") = feature seguinte (leitura)
- Spec: `.specs/features/F1.4-resumo-e-salvar/spec.md`

**F1.5 — Tool `save_knowledge_node` + schema Postgres** - PLANNED

- Migration de tabelas (knowledge_node, source, summary)
- Escrita transacional com tipo (LINK | YOUTUBE | RESEARCH)
- Índices para recuperação por usuário + data

**F1.6 — Tool `search_web_knowledge` (Brave Search API)** - 📝 SPEC (2026-06-02)

- Wrapper sobre Brave Search API com chave em env
- Consolidação de top resultados em resumo Feynman
- Tratamento de rate limit + erros HTTP
- Reusa o worker assíncrono; produz pendente PENDING_RELEASE (par natural da F1.7). Specar/entregar junto com F1.7.
- Spec: `.specs/features/F1.6-search-web-knowledge/spec.md`

**F1.7 — Gatilho async anti-textão** - 📝 SPEC (2026-06-02)

- Resumo de pesquisa salvo em Postgres com status `PENDING_RELEASE`
- Notificação curta no WhatsApp: "Já pesquisei, é só pedir"
- Loop de release com `FOR UPDATE SKIP LOCKED` quando usuário envia gatilho ("pode mandar", "manda", etc.)
- Único item do roadmap que exige concorrência transacional + teste de resiliência (derrubada sob carga).
- Spec: `.specs/features/F1.7-gatilho-async-anti-textao/spec.md`

**F1.8 — Hardening do system prompt** - 📝 SPEC (2026-06-02)

- Prompt blindado contra injection
- Recusa estruturada para pedidos fora do escopo PKM
- Bateria de testes de injection (≥20 ataques conhecidos)
- ⚠️ Modelo de ameaça na spec inclui injeção INDIRETA (conteúdo de página capturada vira instrução) — o vetor mais perigoso dado tools auto-aprovadas.
- Spec: `.specs/features/F1.8-hardening-prompt/spec.md`

**F1.9 — Setup reproduzível + docs + `make verify`** - 📝 SPEC (2026-06-02)

- ⚠️ **Revisão de meio:** Docker Compose → **`setup.sh` + Makefile + smoke test** (a stack é pacotes globais/PM2 + CLIs nativas + tools MCP efêmeras; Docker vira Deferred). Ver "Tensão central" na spec.
- README raiz (caminho clone→1º card) + `.env.example` + higiene do repo (tmux/logs/segredos)
- `make verify` = smoke test ponta-a-ponta (serviços + DB + CLIs + **pipeline determinístico** worker→`knowledge_node`)
- Spec: `.specs/features/F1.9-setup-reproduzivel/spec.md`

**F1.10 — Testes automatizados (suíte `bun test`)** - 📝 SPEC (2026-06-02)

- Feature transversal de qualidade — hoje a cobertura é **ZERO** (critério de banca direto).
- Unit puros (extractJson/CardSchema/formatCard/parse de videoId) + unit com mock de externos (fetch/Gemini/omni) + integração DB (recall/reminder/release).
- Mocka o caro (Gemini/rede/WhatsApp); testa o código ao redor, não a IA. Plugado no `make verify` (parte offline).
- Spec: `.specs/features/F1.10-testes-automatizados/spec.md`

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
