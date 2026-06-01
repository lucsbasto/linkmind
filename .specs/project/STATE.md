# Project State

**Last updated:** 2026-06-01

## Next Step

**Feature:** F0.1 → **CONCLUÍDA**. F0.2 → **CONCLUÍDA (P1+P2+P3, 2026-06-01)** — esqueleto do agente + tool harness com dummy `mcp__hello__ping`, system prompt real, harness documentado. Encerra o **M0 (Fundação)**.
**Phase:** **Início do M1 (captura + pesquisa).** Próxima feature a especificar = primeira story do M1 (provavelmente **F1.1 — detecção de intenção**, ou a ordem que o ROADMAP definir). Ainda **sem spec escrita** para M1.
**Mecânica de tools (corrigida, fonte de verdade):** registro = `agents/linkmind-agent/.mcp.json` (servers) + `.claude/settings.local.json` (`enableAllProjectMcpServers` + `permissions.allow`). **NÃO** via `sdk.*` do `agent.yaml` (o bridge ignora — bloco removido). Verificar tool event por `genie agent log` (não `observe`). Passo-a-passo completo em `tools/README.md`. _(A conclusão antiga do spike de que `genie dir edit --sdk-mcp-server` funcionava estava ERRADA p/ o caminho do bridge — corrigida no P1, ver `discovery.md`.)_
**Action (próximo passo atômico):** **F0.2 fechada.** Próximo = **abrir o ROADMAP e escrever a spec da primeira feature do M1** em `.specs/features/F1.x-.../spec.md` (seguir o fluxo SDD: discovery se precisar → spec → stories). Captura real (`fetch_web_content`, `get_youtube_transcript`), Feynman, Postgres, Brave Search e anti-textão são as features do M1. Ambiente: WSL2 Ubuntu 26.04, usuário `lucsb` (sudo NOPASSWD) — **sempre `cd ~/linkmind`** (workspace é por-diretório). Engine = `claude` CLI nativo (sonnet) spawnado pelo bridge — auth própria do CLI.

**P2 fechado (2026-06-01):** `agents/linkmind-agent/AGENTS.md` reescrito (placeholders → prompt real: missão = segundo cérebro no WhatsApp; anti-textão; usar tools; sempre `omni done`; marcado que captura/pesquisa reais NÃO existem → anti-alucinação). **Bridge confirmado carregando o `AGENTS.md` via `--append-system-prompt-file`** (visto no cmdline do `claude` spawnado). Bloco `sdk.{mcpServers,allowedTools}` **inerte removido do `agent.yaml`** (limpeza pendente do P1; substituído por comentário-nota). Validado E2E pelo WhatsApp: msg natural (autocorrigida p/ "me dá um aço e roda o pink com echo=p2") → agente chamou `mcp__hello__ping`, mandou voice note + texto `pong 🏓 (p2)`, fechou com `omni done`. **Cuidado operacional reconfirmado:** órfãos `claude.*linkmind-agent` ficam vivos após o turno fechar — matar o pid (não derruba a sessão; próximo turno re-spawna `claude --resume <uuid>` relendo o `AGENTS.md`).

**P1 fechado (2026-06-01) — mecanismo de tools CORRIGIDO:** o `genie dir edit --sdk-mcp-server`/`--sdk-allowed-tools` do discovery **NÃO funciona no bridge WhatsApp** (o bridge spawna `claude` nativo com `--permission-mode auto --resume --settings`, SEM `--mcp-config`/`--allowedTools` → o bloco `sdk.*` do `agent.yaml` é ignorado; só valia no smoke test print-mode). **Mecanismo que funciona (E2E confirmado):** `agents/linkmind-agent/.mcp.json` (claude nativo lê do cwd) + auto-aprovação em `agents/linkmind-agent/.claude/settings.local.json` (`enableAllProjectMcpServers: true` + `permissions.allow: ["mcp__hello__ping"]`). Teste: WhatsApp "use a tool ping com echo=oi" → `pong 🏓 (oi)` sem aprovação. **Verificar tool event pelo `genie agent log` (mostra `[C] mcp__hello__ping`), NÃO pelo `genie agent observe`** (contadores ficam 0 / "no linked session" — view não plugada no claude do bridge). Detalhes completos na correção no topo do `discovery.md`. **Limpeza pendente:** o bloco `sdk.{mcpServers,allowedTools}` do `agent.yaml` ficou inerte/enganoso — remover ou comentar (cuidado: `genie dir edit` substitui o bloco `sdk` inteiro, não faz merge).
**Feito em 2026-06-01:** WSL2 + Ubuntu 26.04; toolchain (Node 22.22.2, Bun 1.3.14, PM2 7.0.1, git 2.53.0, tmux 3.6, jq 1.8.1); Omni v2.260410.1 (omni-api:8882 + omni-nats online; key local `omni_sk_b86cf81c8de08b9c836579b9ce973c82` em ~/.omni/config.json); Genie v4.260522.20 (cosign OK, `genie setup --quick`); pgserve/autopg v2.6.10 (autopg-server:5432 + autopg-ui:8433; admin pwd hash em ~/.autopg/admin.json). `pm2 save` feito. **Workspace Genie criado em `~/linkmind`** (nativo Linux — decisão: evitar DrvFs /mnt/c por causa de locks/sockets). **Bridge no ar:** `genie serve start --daemon --headless` → omni-bridge running (ping ~72ms ao Omni), pgserve healthy, scheduler+inbox ativos. Auto-daemonizado pelo Genie (pidfile ~/.genie/serve.pid), **não sob pm2** — se a DoD exigir literal no `pm2 ls`, envelopar depois. **Wiring agente feito:** `genie init agent linkmind-agent` (scaffold em `agents/linkmind-agent/`: AGENTS.md/SOUL.md/HEARTBEAT.md + brain/memory) → `genie agent register linkmind-agent --model sonnet --dir agents/linkmind-agent` (registrado, status offline até ter key) → instância WhatsApp `linkmind` criada (id `05415247-c598-4a2b-832b-f127d4410e10`) → `omni connect 05415247-... linkmind-agent` OK (NATS round-trip; agentId `83fb51a0-...`, providerId `dc0d0de4-...`; inbound `omni.message.05415247-...*`, outbound `omni.reply.05415247-...*`). Falta só: QR pareado + Anthropic key.
**Validado 2026-06-01 (fechamento F0.1):** WhatsApp pareou (instância `linkmind` ACTIVE=yes, perfil "Lucas Bastos", número 556392747980). Ping/pong **end-to-end confirmado** sob serve novo (pid 48391): inbound "olá" 15:37:12 → outbound "pong! 🏓" 15:37:24 (turno spawnou em ~3s). Loop completo: WhatsApp → genie inbox → `claude` CLI (sonnet, AGENTS.md de `agents/linkmind-agent/`) → `omni say`/`omni done` → WhatsApp. **Aprendizado:** o agente autentica pelo `claude` CLI (login próprio), NÃO pela `ANTHROPIC_API_KEY` do env — por isso respondia mesmo antes de carregar a key. Cuidado operacional: ao rodar `genie serve stop/start`, turnos em voo viram órfãos (perdem o caminho de volta) — matar processos `claude.*linkmind-agent` órfãos após restart.
**Blocked by:** _nada_ — F0.1 desbloqueada e concluída.
**Definition of done:** `pm2 ls` mostra `omni-api`, `omni-nats`, `autopg-server` (pgserve) e o bridge `genie` online; `genie doctor` aponta pgserve + NATS acessíveis. **Status:** ✅ omni/nats/pgserve online; ✅ bridge `genie` running (pid 48391); ✅ agente respondendo. (Nota: bridge auto-daemonizado pelo Genie, fora do `pm2 ls` — envelopar em pm2 se a DoD exigir literal. Auto-start no boot adiado — não é requisito MVP.)

> Regra: ao terminar qualquer ação significativa, atualize esta seção com a próxima sub-tarefa atômica antes de fechar a sessão. Nunca deixar vazia.

## Decisions

- **2026-05-31:** Removidos do PRD a ingestão de áudio e o "Agente Consultor Assistente" (Caso de Uso B original). Removidas as ferramentas `transcribe_audio` e `manage_calendar_events`, e o pilar "Mapeamento de APIs Externas (Calendário)". Slogan ajustado para remover "Consultivo".
- **2026-05-31:** Escopo v1 = Núcleo de captura + pesquisa (links/YouTube + Feynman + pesquisa sob demanda async). Zettelkasten automático e revisão espaçada saem do v1 e entram em M2.
- **2026-05-31:** Provedor de busca web = Brave Search API (free tier 2k queries/mês, decisão revisitável se rate limit pesar).
- **2026-05-31:** Contexto do projeto = MVP para terceiros — implica reprodutibilidade rígida e documentação de setup.
- **2026-05-31:** Empacotamento — Omni, Genie e pgserve ficam como pacotes globais supervisionados por PM2 no host (caminho oficial), instalados via `install.sh` e `get.automagik.dev/genie`. Docker Compose cobre apenas os serviços que escrevermos por cima (tool runner e auxiliares). Decisão tomada após descobrir que pgserve é pacote separado, não containerizado pelos repos oficiais.
- **2026-05-31:** Engine do agente = `@anthropic-ai/claude-agent-sdk` (não Claude Code CLI). Isolamento via git worktrees paralelos (não tmux). PRD seção 4.0 corrigida.
- **2026-05-31:** Empacotamento — PRD seção 5.4 corrigida: Docker Compose só cobre serviços que escrevermos por cima do stack oficial Omni/Genie/pgserve.
- ~~**2026-05-31:** Mecânica de registro de tools customizadas TS/Bun no Genie = decisão adiada até o spike da F0.1.~~ **RESOLVIDO 2026-06-01 (spike F0.2):** tools NÃO se registram no `nats-genie` (que é puro transporte). O agente roda via `@anthropic-ai/claude-agent-sdk` (embutido no Genie) e tools entram como **MCP servers** na config SDK do entry: `genie dir edit <agent> --sdk-mcp-server <name>:<command>:<args>` (ou bloco `sdk.mcpServers` no `agent.yaml`). `settingSources` é vazio por default → `.mcp.json` do filesystem é ignorado. Evidências completas em `.specs/features/F0.2-agente-real-tools/discovery.md`.
- **2026-06-01:** Host runtime do stack = **WSL2 + Ubuntu** (não Git Bash nativo). Motivo: scripts oficiais (`install.sh` Omni e `get.automagik.dev/genie`) são bash e os repos são testados em Linux. Trade-off: setup inicial mais longo (~30-45 min com instalação de WSL), mas remove risco de edge cases de Windows. Auto-start no boot adiado — não é requisito de MVP.

## Blockers

- ~~**Anthropic API key não obtida ainda.**~~ **RESOLVIDO 2026-06-01:** `ANTHROPIC_API_KEY` definida e persistida no `~/.bashrc` (prefixo `sk-ant-`, 108 chars). Disponível para o Claude Agent SDK na F0.2.
- **2026-06-01: WhatsApp recusou o pareamento — "não é possível vincular novos aparelhos no momento".** Bloqueio do lado do WhatsApp (anti-abuso), provavelmente disparado por tentativas repetidas de QR em sequência (logs omni-api: `attempts 3/3`, `QR cycle complete, clearing auth and retrying`) e/ou conta/número novo (+5563992747980). Instância `linkmind` **desconectada** para parar o ciclo de QR e deixar esfriar. **Como resolver:** esperar (tipicamente 30min–algumas horas; conta nova pode levar até ~24h), atualizar o app WhatsApp no celular, então fazer **uma** tentativa limpa: deixar a tela "Conectar aparelho" aberta e pronta ANTES, gerar UM QR fresco e escanear em <15s (evitar reciclar/restart repetidos, que reacionam o bloqueio). Tudo o mais já wired (agente registrado + `omni connect` feito), então é passo único quando liberar.

## Lessons

_Vazio — projeto recém-iniciado._

## Todos

- (Pós-F0.1) Apagar `.tmp-spike/` (clones temporários de Omni/Genie usados pelo spike) quando deixar de ser útil.
- (F1.3) Confirmar disponibilidade de `youtube-transcript` (ou alternativa) para Bun em ambiente Linux.
- ~~(F0.1 / agente stub) Obter chave da API Anthropic.~~ ✅ Feito 2026-06-01 (no `~/.bashrc`).

## Deferred Ideas

- Re-introduzir áudio (Speech-to-Text) se persona/terceiros pedirem após validação inicial.
- Re-introduzir agente consultor + integração com calendário se houver demanda.
- Migração para VPS para suportar uso 24/7 e tornar revisão espaçada (M2) realmente proativa.
- Multi-tenancy / múltiplos usuários no mesmo deployment.

## Known Tensions

- **"MVP para terceiros" + "100% local":** terceiros precisam de uma máquina ligada para o LinkMind responder. Validar com 2-3 usuários técnicos primeiro; se a fricção bloquear adoção, antecipar migração a VPS antes do final do M1.

## Preferences

_Vazio — será populado conforme aprendemos a colaborar._
