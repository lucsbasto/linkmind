# Project State

**Last updated:** 2026-06-01

## Next Step

**Feature:** F0.1 — Setup Omni + Genie + pgserve com agente stub
**Phase:** Execute → story P1 "Stack instalada e supervisionada" **CONCLUÍDA (substância)** → próxima: story P1 "WhatsApp pareado" + "Agente stub respondendo"
**Action (próximo passo atômico):** (1) **Obter Anthropic API key** em console.anthropic.com e configurar (`ANTHROPIC_API_KEY` no ambiente do `genie serve`) — blocker do agente. (2) Registrar agente stub: `cd ~/linkmind && genie init agent linkmind-agent` (ou `genie agent register`) com system prompt mínimo ("ping"→"pong", senão "ack"). (3) `omni connect <instance> linkmind-agent`. (4) Parear WhatsApp: `omni instances create <name> --channel whatsapp-baileys` + `omni instances qr <id> --watch` (QR no terminal — passo interativo do usuário, com celular). Reiniciar bridge após setar a key: `cd ~/linkmind && genie serve stop && genie serve start --daemon --headless`. Tudo em WSL2 Ubuntu 26.04, usuário `lucsb` (sudo NOPASSWD), via `wsl -d Ubuntu -u lucsb` — **sempre `cd ~/linkmind`** (workspace é por-diretório).
**Feito em 2026-06-01:** WSL2 + Ubuntu 26.04; toolchain (Node 22.22.2, Bun 1.3.14, PM2 7.0.1, git 2.53.0, tmux 3.6, jq 1.8.1); Omni v2.260410.1 (omni-api:8882 + omni-nats online; key local `omni_sk_b86cf81c8de08b9c836579b9ce973c82` em ~/.omni/config.json); Genie v4.260522.20 (cosign OK, `genie setup --quick`); pgserve/autopg v2.6.10 (autopg-server:5432 + autopg-ui:8433; admin pwd hash em ~/.autopg/admin.json). `pm2 save` feito. **Workspace Genie criado em `~/linkmind`** (nativo Linux — decisão: evitar DrvFs /mnt/c por causa de locks/sockets). **Bridge no ar:** `genie serve start --daemon --headless` → omni-bridge running (ping ~72ms ao Omni), pgserve healthy, scheduler+inbox ativos. Auto-daemonizado pelo Genie (pidfile ~/.genie/serve.pid), **não sob pm2** — se a DoD exigir literal no `pm2 ls`, envelopar depois.
**Blocked by:** **Anthropic API key não obtida** — bloqueia validar o agente stub (ping/pong) e o critério "Anthropic API key configurada" do `genie doctor`. Resolver em console.anthropic.com. (Auto-start no boot adiado por decisão; o bridge não sobrevive a reboot até configurarmos isso — não é requisito MVP.)
**Definition of done:** `pm2 ls` mostra `omni-api`, `omni-nats`, `autopg-server` (pgserve) e o bridge `genie` online; `genie doctor` aponta pgserve + NATS acessíveis e Anthropic API key configurada. **Status:** omni/nats/pgserve ✅ online; bridge `genie` + Anthropic key ⏳ pendentes.

> Regra: ao terminar qualquer ação significativa, atualize esta seção com a próxima sub-tarefa atômica antes de fechar a sessão. Nunca deixar vazia.

## Decisions

- **2026-05-31:** Removidos do PRD a ingestão de áudio e o "Agente Consultor Assistente" (Caso de Uso B original). Removidas as ferramentas `transcribe_audio` e `manage_calendar_events`, e o pilar "Mapeamento de APIs Externas (Calendário)". Slogan ajustado para remover "Consultivo".
- **2026-05-31:** Escopo v1 = Núcleo de captura + pesquisa (links/YouTube + Feynman + pesquisa sob demanda async). Zettelkasten automático e revisão espaçada saem do v1 e entram em M2.
- **2026-05-31:** Provedor de busca web = Brave Search API (free tier 2k queries/mês, decisão revisitável se rate limit pesar).
- **2026-05-31:** Contexto do projeto = MVP para terceiros — implica reprodutibilidade rígida e documentação de setup.
- **2026-05-31:** Empacotamento — Omni, Genie e pgserve ficam como pacotes globais supervisionados por PM2 no host (caminho oficial), instalados via `install.sh` e `get.automagik.dev/genie`. Docker Compose cobre apenas os serviços que escrevermos por cima (tool runner e auxiliares). Decisão tomada após descobrir que pgserve é pacote separado, não containerizado pelos repos oficiais.
- **2026-05-31:** Engine do agente = `@anthropic-ai/claude-agent-sdk` (não Claude Code CLI). Isolamento via git worktrees paralelos (não tmux). PRD seção 4.0 corrigida.
- **2026-05-31:** Empacotamento — PRD seção 5.4 corrigida: Docker Compose só cobre serviços que escrevermos por cima do stack oficial Omni/Genie/pgserve.
- **2026-05-31:** Mecânica de registro de tools customizadas TS/Bun no Genie = decisão adiada até o spike da F0.1 (não documentado nos repos públicos; precisa leitura de código fonte do provider `nats-genie`).
- **2026-06-01:** Host runtime do stack = **WSL2 + Ubuntu** (não Git Bash nativo). Motivo: scripts oficiais (`install.sh` Omni e `get.automagik.dev/genie`) são bash e os repos são testados em Linux. Trade-off: setup inicial mais longo (~30-45 min com instalação de WSL), mas remove risco de edge cases de Windows. Auto-start no boot adiado — não é requisito de MVP.

## Blockers

- **Anthropic API key não obtida ainda.** Necessária no momento em que F0.2 começar a invocar o Claude Agent SDK. Não bloqueia o spike (leitura de código) nem a instalação do stack. Resolver criando conta em console.anthropic.com.

## Lessons

_Vazio — projeto recém-iniciado._

## Todos

- (Pós-F0.1) Apagar `.tmp-spike/` (clones temporários de Omni/Genie usados pelo spike) quando deixar de ser útil.
- (F1.3) Confirmar disponibilidade de `youtube-transcript` (ou alternativa) para Bun em ambiente Linux.
- (F0.1 / agente stub) Obter chave da API Anthropic em console.anthropic.com antes da story P1 "Agente stub respondendo".

## Deferred Ideas

- Re-introduzir áudio (Speech-to-Text) se persona/terceiros pedirem após validação inicial.
- Re-introduzir agente consultor + integração com calendário se houver demanda.
- Migração para VPS para suportar uso 24/7 e tornar revisão espaçada (M2) realmente proativa.
- Multi-tenancy / múltiplos usuários no mesmo deployment.

## Known Tensions

- **"MVP para terceiros" + "100% local":** terceiros precisam de uma máquina ligada para o LinkMind responder. Validar com 2-3 usuários técnicos primeiro; se a fricção bloquear adoção, antecipar migração a VPS antes do final do M1.

## Preferences

_Vazio — será populado conforme aprendemos a colaborar._
