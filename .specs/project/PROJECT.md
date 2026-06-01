# LinkMind

**Vision:** Segundo cérebro pessoal conversacional e proativo no WhatsApp — captura links/vídeos e dúvidas, devolve resumos cognitivos estruturados e pílulas de pesquisa sob demanda, sem poluir o chat.
**For:** Aprendiz Contínuo (lifelong learner) que consome muito conteúdo no WhatsApp e perde tudo no "cemitério de arquivos mortos".
**Solves:** O conhecimento se perde porque links ficam soterrados, dúvidas viram pesquisas que nunca acontecem, e textos longos não cabem na UX de chat.

## Goals

- **Captura sem fricção:** Ingerir 100% das URLs (web + YouTube) enviadas pelo usuário e devolver um card estruturado (Ideia Central / Pilares / Aplicação) em ≤ 30s do envio.
- **Pesquisa anti-textão:** Para dúvidas textuais, executar pesquisa web em segundo plano e responder no WhatsApp com pílula curta + gatilho "pode mandar" — texto denso só vai ao chat sob comando explícito.
- **Resiliência transacional:** Zero perda/duplicação de knowledge nodes ou agendamentos mesmo com queda do servidor (validar com derrubada manual da infra durante carga).
- **MVP validável por terceiros:** Pelo menos 3 usuários externos conseguem rodar o setup local e usar por 7 dias sem suporte.

## Tech Stack

**Core:**

- Canal: **Omni** (Namastex Labs) — TS/Bun, WhatsApp via Baileys, publica em NATS JetStream (subject `message.received.whatsapp-baileys.<instance>`, payload `IncomingMessageSchema`)
- Orquestração: **Genie** (Namastex Labs) — TS/Bun, daemon que consome NATS e executa o agente
- Agente: **`@anthropic-ai/claude-agent-sdk`** (executado de dentro do Genie, modelo a definir — provável `claude-opus-4-7`) com prompt blindado contra injection. Isolamento entre execuções via git worktrees paralelos
- Tools runtime: **TypeScript + Bun** (mecânica de registro junto ao Genie a ser definida no spike de F0.1)
- Banco: **pgserve** (pacote `pgserve@^2` da Namastex) — Postgres supervisionado por PM2 no host, porta default `8432`, db `omni`
- Supervisão de processos host: **PM2** (Omni + Genie + pgserve)
- Empacotamento: **Docker Compose** para os serviços que escrevermos por cima (tool runner e auxiliares), com script `make verify` para smoke test ponta a ponta

**Key dependencies:**

- Brave Search API — pesquisa web para `search_web_knowledge`
- `youtube-transcript` ou equivalente — extração de legendas
- `@mozilla/readability` + `jsdom` (ou equivalente) — scraper universal de páginas web
- Driver `pg` ou `postgres` (Bun-compatible) — acesso ao pgserve com `FOR UPDATE SKIP LOCKED`

## Scope

**v1 includes:**

- Pipeline de ingestão de **links web e vídeos YouTube** (scraper + transcript)
- **Sumarização cognitiva Feynman** (Ideia Central, Pilares, Aplicação Prática) persistida em Postgres
- **Detecção dinâmica de intenção** (link para arquivar vs dúvida para pesquisar)
- **Pesquisa sob demanda async** com Brave Search + gatilho anti-textão ("pode mandar")
- **Persistência transacional** de knowledge nodes com `FOR UPDATE SKIP LOCKED` no loop de release
- **Hardening do system prompt** contra prompt injection (escopo PKM apenas)
- **Setup reproduzível** via Docker Compose para validação por terceiros

**Explicitly out of scope (v1):**

- Ingestão de **áudio** (Speech-to-Text) — removido do PRD
- **Agente Consultor Assistente** (raciocínio multi-passo + execução em agenda) — removido do PRD
- **Cruzamento Zettelkasten automático** entre notas — adiado para pós-MVP
- **Revisão espaçada proativa** (anti-esquecimento) — adiado para pós-MVP
- Deploy em VPS / hosting 24/7 — adiado; v1 roda local
- App próprio / interface web — WhatsApp é a única UX

## Constraints

- **Técnico:** Omni, Genie e pgserve rodam como pacotes globais supervisionados por PM2 no host (não containerizados — esse é o caminho oficial). Docker Compose cobre apenas os serviços que escrevermos por cima.
- **Técnico:** Toda decisão precisa preservar o contrato de eventos NATS JetStream entre Omni → Genie (subjects `message.received.{channel}.{instance}`, schema `IncomingMessageSchema` em Zod).
- **Validação:** Banca/terceiros precisam conseguir reproduzir o setup via scripts oficiais do ecossistema + nosso `docker compose up` + um `make verify` (ou equivalente) que rode smoke test ponta a ponta.
- **Tensão conhecida:** "MVP para terceiros" + "100% local" — para teste contínuo por usuários externos será necessária máquina ligada ou migração a VPS. Decisão adiada para após validação inicial.
