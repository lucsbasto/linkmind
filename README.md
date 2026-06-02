# LinkMind

> Seu **segundo cérebro dentro do WhatsApp**. Você manda um link, ele captura o
> conteúdo, resume no estilo Feynman, guarda — e devolve sob demanda (resumo,
> Q&A sobre o texto completo, e lembretes proativos do que você salvou e não leu).

LinkMind é um agente de PKM (personal knowledge management) que vive atrás de um
número de WhatsApp. Ele **não é um chatbot tagarela**: responde curto, usa
ferramentas para o trabalho pesado e trabalha em segundo plano para não poluir o chat.

---

## Quickstart (TL;DR)

Já tem a stack base no ar (Omni, Genie, pgserve, com `claude` e `gemini` logados)? Então:

```bash
make setup     # idempotente: deps das tools, migrations, registra agente + schedule
make start     # sobe pm2 + bridge (genie serve)
make verify    # smoke test: 9 checks (serviços, DB, schema, WhatsApp) — exit 0 = tudo de pé
```

`make` sem argumento lista todos os alvos. Ainda não tem a stack base? Siga o
[Setup passo a passo](#setup-passo-a-passo) (instala Omni/Genie/pgserve e detalha os
passos manuais: login do `claude`, OAuth do `gemini`, pareamento do QR).

> O `make verify` é **determinístico e offline** — exercita o banco de verdade, mas
> **não** dispara Gemini nem manda WhatsApp (lento, gasta quota, tem efeito colateral).
> Para exercer o OAuth real do Gemini: `make verify-full`. O E2E completo (link no
> WhatsApp → card de volta) é o aceite manual de [Execução e operação](#execução-e-operação).

---

## Sumário

- [Quickstart (TL;DR)](#quickstart-tldr)
- [Como funciona (arquitetura)](#como-funciona-arquitetura)
- [O caminho de uma mensagem](#o-caminho-de-uma-mensagem)
- [Pré-requisitos](#pré-requisitos)
- [Setup passo a passo](#setup-passo-a-passo)
  - [1. Toolchain](#1-toolchain)
  - [2. pgserve (Postgres)](#2-pgserve-postgres)
  - [3. Omni (canal WhatsApp)](#3-omni-canal-whatsapp)
  - [4. Genie (bridge do agente)](#4-genie-bridge-do-agente)
  - [5. Gemini CLI (motor de resumo)](#5-gemini-cli-motor-de-resumo)
  - [6. Anthropic / engine do agente](#6-anthropic--engine-do-agente)
  - [7. Clonar e configurar o LinkMind](#7-clonar-e-configurar-o-linkmind)
  - [8. Banco de dados (migrations)](#8-banco-de-dados-migrations)
  - [9. Registrar o agente e parear o WhatsApp](#9-registrar-o-agente-e-parear-o-whatsapp)
  - [10. Lembretes proativos (agendamento)](#10-lembretes-proativos-agendamento)
- [Execução e operação](#execução-e-operação)
- [Adaptações técnicas (o que um terceiro PRECISA trocar)](#adaptações-técnicas-o-que-um-terceiro-precisa-trocar)
- [As ferramentas do agente](#as-ferramentas-do-agente)
- [Testes](#testes)
- [Decisões arquiteturais (ADRs)](#decisões-arquiteturais-adrs)
- [Troubleshooting](#troubleshooting)

---

## Como funciona (arquitetura)

LinkMind se apoia em três serviços de infraestrutura (pacotes externos, não escritos
aqui) + o código deste repositório:

| Camada | Papel | De onde vem |
|---|---|---|
| **Omni** | Conecta ao WhatsApp (via Baileys), recebe/envia mensagens, faz pareamento por QR | pacote global (`omni`) |
| **Genie** | "Bridge": ouve mensagens do Omni via NATS e **spawna o agente** (`claude` CLI nativo) para cada turno | pacote global (`genie`) |
| **pgserve / autopg** | Postgres local acessível por **socket unix** com `trust` | pacote global |
| **Gemini CLI** | Motor de **sumarização e Q&A** (shell-out headless). NÃO é o modelo do agente | `@google/gemini-cli` |
| **LinkMind (este repo)** | O **agente** (`agents/linkmind-agent/`) + as **tools MCP** (`tools/`) que fazem captura, resumo, persistência e recuperação | este repositório |

> Detalhe importante de design: o resumo é feito pelo **Gemini CLI**, enquanto a
> conversa/roteamento é feita pelo **`claude` CLI** que o Genie spawna. São dois
> motores de LLM diferentes, de propósito.

As tools são **MCP servers stdio** em TypeScript rodando sob **Bun**. Cada uma é um
projeto Bun isolado em `tools/<nome>/` com seu próprio `node_modules`. O agente as
descobre via `.mcp.json` e as auto-aprova via `.claude/settings.local.json`.

```
tools/
  knowledge/        # tools de produto: archive_link, send_summary, ask_article + worker/reminder
  fetch-web-content/ # tool web: fetch_web_content (resposta imediata, sem salvar)
  hello-mcp/        # tool dummy de harness: ping (só para teste)
agents/
  linkmind-agent/   # definição do agente: AGENTS.md (prompt), .mcp.json, settings.local.json
```

---

## O caminho de uma mensagem

Esse é o fluxo ponta a ponta — **do WhatsApp até a resposta no WhatsApp** — para o
caso principal (usuário manda um link para arquivar):

```
1. Usuário manda um link no WhatsApp
        │
2. Omni (Baileys) recebe → publica em NATS (omni.message.<instance>.<chat>)
        │
3. Genie (omni-bridge) consome → spawna o `claude` CLI com o AGENTS.md como system prompt
        │
4. O agente reconhece "é um link pra guardar" → chama a tool  mcp__knowledge__archive_link(url, chat)
   (passando o JID do chat de origem, copiado do contexto do turno)
        │
5. A tool VALIDA a URL e dispara um worker DESACOPLADO (`setsid bun run worker.ts <url> <chat>`),
   retornando na hora { status: "processing" }
        │
6. O agente manda um ACK curto ("beleza, tô resumindo 👍") e fecha o turno com `omni done`
        │   ── (turno acabou; o worker segue vivo em background) ──
        │
7. worker.ts:  extract.ts (captura o texto via Readability/linkedom)
             → summarize.ts (resumo Feynman via `gemini -p`, texto pelo stdin)
             → grava no Postgres (tabela knowledge_node: card + texto completo)
             → notify.ts: `omni send` manda a CONFIRMAÇÃO curta de volta pro chat
        │
8. ~1-2 min depois, o card de "salvo ✅" chega como mensagem nova no WhatsApp
```

Outros fluxos:

- **"me manda o resumo de X"** → `send_summary` (síncrono, sem Gemini): busca no banco
  por assunto e reenvia o card completo.
- **"qual o pseudocódigo do artigo?"** → `ask_article` (assíncrono): consulta o **texto
  completo** salvo com o Gemini e responde a pergunta numa mensagem nova.
- **"lê isso e me fala rapidinho"** → `fetch_web_content` (imediato, não salva).
- **Lembrete proativo** → `reminder.ts` roda 1x/dia (via `genie schedule`) e cutuca
  artigos salvos há ≥ N dias que você nunca abriu.

A resposta sai do agente publicando em NATS (`omni.reply.<instance>.<chat>`) via
`omni done` / `SendMessage(to: omni)`; o worker, por estar fora do turno, usa o
binário `omni send` diretamente.

---

## Pré-requisitos

- **WSL2 + Ubuntu** (testado no Ubuntu 26.04). O stack roda **nativo no Linux** —
  use o filesystem do Linux (`~/linkmind`), **não** `/mnt/c` (locks e sockets quebram em DrvFs).
- Usuário com `sudo` (idealmente NOPASSWD para conforto).
- Um **número de WhatsApp dedicado** para parear (use um chip/conta separada — o
  pareamento ocupa um "aparelho vinculado").
- Acesso à internet para baixar os scripts oficiais de Omni/Genie/pgserve.

Versões de referência validadas neste projeto:

| Ferramenta | Versão |
|---|---|
| Node | 22.22.2 |
| Bun | 1.3.14 |
| PM2 | 7.0.1 |
| Omni | 2.260410.1 |
| Genie | 4.260522.20 |
| Gemini CLI | 0.44.1 |
| pgserve/autopg | 2.6.x |

---

## Setup passo a passo

> Tempo alvo: **~30 min** para um técnico, partindo de um Ubuntu/WSL limpo.
>
> **Omni, Genie e pgserve são pacotes do ecossistema Namastex/automagik** — você os
> instala pelos **instaladores oficiais deles**, não por este repositório. As fontes
> canônicas (conforme o `docs/PRD.md`, seção 5.4) são: **Genie** via
> `get.automagik.dev/genie` e **Omni** via o `install.sh` oficial; o **pgserve/autopg**
> acompanha esse ecossistema. Os one-liners exatos evoluem com o fornecedor — **confira
> a doc oficial atual** ao instalar. Abaixo está a **ordem correta**, o que cada peça
> faz e **como validar (checkpoint) cada etapa** antes de seguir. Ao final, cada
> checkpoint verde garante que o passo seguinte tem o que precisa.
>
> Caminho: **toolchain → pgserve → Omni → Genie → Gemini → auth do agente → clonar este
> repo → migrations → registrar agente + parear → agendar lembrete → verificar E2E.**

### 1. Toolchain

```bash
# Node 22 (via nvm ou nodesource), depois:
curl -fsSL https://bun.sh/install | bash          # Bun → ~/.bun/bin/bun
npm i -g pm2                                       # supervisor de processos
sudo apt-get install -y git tmux jq                # utilitários
```

Confirme que `~/.bun/bin` está no `PATH` (o `bun install` adiciona ao `~/.bashrc`).
Isso é **crítico**: as tools são `#!/usr/bin/env bun` e o `omni` também — sem `bun`
no PATH eles morrem com código 127.

### 2. pgserve (Postgres)

Instale o pgserve/autopg (pacote do ecossistema automagik) e suba-o sob PM2. Ele sobe
dois processos: `autopg-server` (o Postgres, porta 5432) e `autopg-ui` (porta ~8433);
a senha admin fica em `~/.autopg/admin.json`. O LinkMind conecta por **socket unix com
`trust`** (sem senha), não por host/porta:

```
socket default: $XDG_RUNTIME_DIR/pgserve/.s.PGSQL.5432   (ex.: /run/user/1000/pgserve/.s.PGSQL.5432)
```

**Checkpoint:**

```bash
pm2 ls                                 # autopg-server (e autopg-ui) "online"
ls $XDG_RUNTIME_DIR/pgserve            # o socket .s.PGSQL.5432 deve existir
# round-trip pelo socket (deve imprimir "1"):
bun -e 'import {SQL} from "bun"; const s=new SQL({path:`${process.env.XDG_RUNTIME_DIR}/pgserve/.s.PGSQL.5432`,username:"postgres",database:"postgres",tls:false}); console.log((await s`SELECT 1 AS ok`)[0].ok); await s.end()'
```

Se o checkpoint do socket falhar, nada depois (migrations, recall, reminder) funciona.

> Quirk descoberto e já tratado no código: no `Bun.sql`, conexão por socket é
> `new SQL({ path: <socket>, tls: false })` (NÃO `hostname`+`port`, que dá
> "Connection closed" por negociação TLS). E colunas `jsonb` voltam como **string**
> (por isso o código faz `JSON.parse`). Ver `tools/knowledge/db.ts`.
> O Postgres do **Omni** é outro (`localhost:8432/omni`) — **não** use esse; o
> LinkMind usa o pgserve/autopg na 5432 via socket.

### 3. Omni (canal WhatsApp)

Instale o Omni pelo `install.sh` oficial do ecossistema e suba sob PM2. Ele expõe a API
local (`omni-api`, porta ~8882) + NATS (`omni-nats`). A chave da API local é gerada na
instalação e fica em `~/.omni/config.json`.

**Checkpoint:**

```bash
omni --version                 # ex.: 2.260410.1 (server ✓)
pm2 ls                         # omni-api e omni-nats "online"
omni instances list            # roda sem erro (ainda sem instância — normal)
pm2 save                       # persiste a lista pra `pm2 resurrect` pós-reboot
```

O pareamento do WhatsApp é feito mais à frente (passo 9), depois que o agente existir.

### 4. Genie (bridge do agente)

Instale o Genie pelo instalador oficial (`get.automagik.dev/genie`) e rode o setup
rápido. O Genie é quem ouve o Omni via NATS e **spawna o `claude` CLI** a cada turno.

```bash
genie setup --quick
genie doctor                   # CHECKPOINT: pgserve acessível + NATS acessível + (Anthropic key)
```

> `genie doctor` é o checkpoint que prova que Genie ↔ pgserve ↔ NATS estão conversando.
> Se a `ANTHROPIC_API_KEY` faltar, ele reclama explicitamente aqui (resolva no passo 6).

O bridge roda como **daemon próprio** (pidfile `~/.genie/serve.pid`), **fora do
`pm2 ls`** — não tente envelopá-lo no PM2 a menos que precise:

```bash
genie serve start --daemon --headless
ls ~/.genie/serve.pid          # CHECKPOINT: pidfile existe → bridge no ar
```

> Pós-reboot o pgserve/Omni voltam com `pm2 resurrect`, mas o bridge **não** está no
> PM2 — suba-o manualmente com o comando acima (ver [runbook pós-reboot](#runbook-pós-reboot-validado)).

### 5. Gemini CLI (motor de resumo)

Instale **nativo no Linux** (não use o binário Windows de `/mnt/c`):

```bash
npm i -g @google/gemini-cli      # /usr/bin/gemini → @google/gemini-cli
gemini --version
```

Autentique em modo **OAuth pessoal headless** (abre uma URL para login no navegador;
as credenciais ficam em `~/.gemini/oauth_creds.json`). Teste que funciona sem TTY:

```bash
echo "diga apenas: ok" | gemini -p "responda em uma palavra"
# deve retornar OK, exit 0. Ruído no stderr (ripgrep/IDEClient) é inofensivo.
```

O `summarize.ts` envia o texto do artigo pelo **stdin** (evita ARG_MAX) e a instrução
pelo `-p`; descarta o stderr ruidoso e valida o JSON de saída com `zod`.

### 6. Anthropic / engine do agente

O agente é executado pelo **`claude` CLI nativo** (modelo Sonnet) que o Genie spawna.
A autenticação é a **do próprio `claude` CLI** (faça login nele). Como reforço/fallback,
defina a chave no ambiente e persista no `~/.bashrc`:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
echo 'export ANTHROPIC_API_KEY=sk-ant-...' >> ~/.bashrc
```

### 7. Clonar e configurar o LinkMind

```bash
git clone git@github.com:lucsbasto/linkmind.git ~/linkmind
cd ~/linkmind

# Variáveis de ambiente (todas têm default; ajuste o necessário — ver seção de adaptações)
cp .env.example .env
$EDITOR .env

# Instalar deps de CADA tool (cada uma é um projeto Bun isolado)
( cd tools/knowledge        && bun install )
( cd tools/fetch-web-content && bun install )
( cd tools/hello-mcp        && bun install )

# Ativar o git hook de pre-push (roda a suíte antes de cada push)
git config core.hooksPath .githooks
```

> **⚠️ `agents/linkmind-agent/.claude/settings.local.json` é git-ignored** (regra
> `.claude/` no `.gitignore`) — ele **não vem no clone**. Você precisa recriá-lo
> (ver [As ferramentas do agente](#as-ferramentas-do-agente) / passo 9). É ele que
> auto-aprova as tools; sem ele o agente pede aprovação manual a cada chamada (que
> ninguém vê no WhatsApp).

### 8. Banco de dados (migrations)

O runner é idempotente: cria o database `linkmind` se faltar e aplica todos os
`migrations/*.sql` em ordem.

```bash
cd ~/linkmind/tools/knowledge
bun run migrate.ts
# [migrate] database criado: linkmind
# [migrate] aplicada: 001_knowledge_node.sql
# [migrate] aplicada: 002_reminders.sql
# [migrate] aplicada: 003_content.sql
# [migrate] ok
```

Schema resultante (`knowledge_node`): `id, url, title, topico, card (jsonb),
summary_text, content (texto completo do artigo), chat (origem),
created_at, last_recalled_at, reminder_count, last_reminder_at`.

**Checkpoint** (confirma que as 3 migrations foram aplicadas — 12 colunas):

```bash
cd ~/linkmind && bun -e 'import {openDb} from "./tools/knowledge/db.ts"; const db=openDb(); const r=await db`SELECT column_name FROM information_schema.columns WHERE table_name=${"knowledge_node"}`; console.log(r.length, "colunas:", r.map(x=>x.column_name).join(", ")); await db.end()'
# 12 colunas: id, url, title, topico, card, summary_text, created_at, chat, last_recalled_at, reminder_count, last_reminder_at, content
```

### 9. Registrar o agente e parear o WhatsApp

A partir de `~/linkmind` (o workspace do Genie é **por diretório** — sempre rode daqui):

```bash
# (a) Registrar o agente já versionado neste repo
genie agent register linkmind-agent --model sonnet --dir agents/linkmind-agent
genie agent list                           # CHECKPOINT: linkmind-agent aparece (model sonnet)

# (b) Criar a instância de WhatsApp e parear via QR
omni instances create linkmind
omni instances qr <instanceId> --watch     # escaneie o QR no celular dedicado
omni instances list                        # CHECKPOINT: ACTIVE=yes / status "connected"

# (c) Conectar a instância ao agente (associa o canal ao bridge do Genie)
omni connect <instanceId> linkmind-agent
```

> **Construindo do zero (sem clonar este repo)?** A pasta do agente foi originalmente
> criada com `genie init agent linkmind-agent` (gera o scaffold `AGENTS.md` / `SOUL.md`
> / `HEARTBEAT.md` + `brain/memory/`); depois o `AGENTS.md` foi reescrito com o prompt
> real (missão de segundo cérebro + anti-textão + gatilhos de cada tool) e o
> `.mcp.json` foi adicionado. Se você **clonou**, tudo isso já vem pronto — pule o
> `genie init` e vá direto para o `genie agent register` acima.

Recrie o arquivo de auto-aprovação das tools (git-ignored — ver passo 7):

`agents/linkmind-agent/.claude/settings.local.json`
```json
{
  "agentName": "linkmind-agent",
  "autoMemoryEnabled": true,
  "autoMemoryDirectory": "./brain/memory",
  "enableAllProjectMcpServers": true,
  "permissions": {
    "allow": [
      "mcp__hello__ping",
      "mcp__web__fetch_web_content",
      "mcp__knowledge__archive_link",
      "mcp__knowledge__send_summary",
      "mcp__knowledge__ask_article"
    ]
  }
}
```

Teste o ping/pong ponta a ponta: mande `ping` do celular pareado → deve voltar
`pong` em ≤ 10s. Depois mande um link real → ack curto na hora + card ~1-2 min depois.

> **Pareamento recusado ("não é possível vincular novos aparelhos")?** É anti-abuso
> do WhatsApp, geralmente por tentativas repetidas de QR ou número muito novo. Pare o
> ciclo de QR, espere (de 30 min até ~24h em conta nova), atualize o app, e faça **uma**
> tentativa limpa: deixe a tela "Conectar aparelho" aberta ANTES, gere UM QR fresco e
> escaneie em < 15s.

### 10. Lembretes proativos (agendamento)

O `reminder.ts` varre artigos não lidos parados há ≥ N dias e manda um cutucão por
chat. Agende-o com o `genie schedule` (cron nativo, roda dentro do `genie serve`):

```bash
genie schedule create linkmind-nudge \
  --command "$HOME/.bun/bin/bun run $HOME/linkmind/tools/knowledge/reminder.ts" \
  --every "0 9 * * *" \
  --timezone America/Sao_Paulo
```

Defaults overrideáveis por env: `LINKMIND_REMINDER_DIAS` (3) e `LINKMIND_REMINDER_MAX` (3).

```bash
genie schedule list            # CHECKPOINT: linkmind-nudge "active", próxima data às 09:00
```

> **Limitação MVP local:** se a máquina estiver desligada às 9h, o dia é pulado (sem
> catch-up). O schedule sobrevive a reboot (persistido no pgserve), mas exige o
> `genie serve` no ar.

### 11. Verificação final (smoke test do miolo)

Antes de validar pelo WhatsApp, prove o **pipeline determinístico** sem mandar mensagem
real — rodando o worker direto contra uma URL e conferindo que a linha aparece no banco.
Use o seu próprio JID de chat como destino de teste (de `LINKMIND_OMNI_TO` no `.env`, só
para teste headless), ou um placeholder se não quiser receber a confirmação:

```bash
cd ~/linkmind/tools/knowledge

# 1. CLIs vivos
command -v claude && claude --version          # engine do agente presente
echo "ok" | gemini -p "responda em uma palavra" # OAuth Gemini válido (exit 0)

# 2. Pipeline real headless: captura → Gemini → grava em knowledge_node → omni send
bun run worker.ts "https://code.claude.com/docs/en/skills" "<SEU_JID@lid>"
#   acompanhe: tail -f worker.log   (start → omni send OK → done) — leva ~1-2 min (Gemini)

# 3. Conferir que gravou (card + content preenchidos)
cd ~/linkmind && bun -e 'import {openDb} from "./tools/knowledge/db.ts"; const db=openDb(); const r=await db`SELECT topico, (card IS NOT NULL) AS tem_card, (content IS NOT NULL) AS tem_texto, created_at FROM knowledge_node ORDER BY created_at DESC LIMIT 1`; console.log(r[0]); await db.end()'
#   → { topico: "...", tem_card: true, tem_texto: true, created_at: ... }
```

Se os três passos passam, o miolo está reproduzido. O **E2E real** é o teste do passo 9:
mandar um link pelo WhatsApp e receber o card. (Os componentes interativos — login
`claude`, OAuth `gemini`, QR do WhatsApp — não dá para automatizar; são os pontos manuais.)

---

## Execução e operação

> **Com o autostart configurado (ver abaixo), você não precisa rodar nada** — tudo,
> inclusive o bridge, sobe sozinho no boot. Os comandos abaixo são para o caso de você
> ainda **não** ter configurado o autostart, ou para subir/checar manualmente.

### Subir tudo (manual)

```bash
pm2 ls                                   # omni-api, omni-nats, autopg-server, genie-bridge online
omni instances list                      # instância "connected"
```

> Se o `genie-bridge` ainda não estiver no PM2 (setup antigo), o jeito manual avulso é
> `genie serve start --daemon --headless`. Prefira colocá-lo no PM2 (seção de autostart).

### Runbook pós-reboot

Com o autostart (PM2 + systemd) configurado, o reboot é **automático** — systemd sobe o
PM2, que ressuscita todos os processos salvos (incluindo `genie-bridge`). Se precisar
forçar na mão:

```bash
pm2 resurrect                            # restaura TODOS os processos salvos (inclui genie-bridge)
omni instances whoami <instanceId>       # confirme state: connected
```

### Autostart no boot (PM2 + systemd) — já configurado neste host

Para o sistema voltar a receber mensagens sozinho após ligar o PC, o bridge do Genie
roda **dentro do PM2** (não como daemon avulso) e o PM2 sobe via systemd. Passos
(idempotentes — rodar de novo não quebra):

```bash
# 1. Bridge sob PM2 via wrapper (fixa PATH + limpa pidfile órfão + roda em FOREGROUND).
#    Foreground é essencial: sob PM2, o modo --daemon causa loop de restart.
pm2 start ~/linkmind/scripts/bridge.sh --name genie-bridge --interpreter bash

# 2. Congelar a lista atual (entra no dump que o resurrect lê).
pm2 save

# 3. Instalar o serviço systemd que sobe o PM2 no boot.
#    ⚠️ No WSL o $PATH tem entradas do Windows com espaços que quebram o `env`;
#    monte um PATH limpo (só node + /usr/bin) ao rodar com sudo:
sudo env PATH="$(dirname "$(which node)"):/usr/local/bin:/usr/bin:/bin" \
  "$(which pm2)" startup systemd -u "$USER" --hp "$HOME"

# 4. Verificar
systemctl is-enabled pm2-$USER           # → enabled
pm2 ls                                    # genie-bridge online (↺ baixo/estável)
```

Operação do bridge daqui pra frente:

```bash
pm2 restart genie-bridge    # após mexer em .mcp.json/AGENTS.md/server.ts (recarrega config)
pm2 logs genie-bridge       # acompanhar mensagens chegando ao vivo (omni.message.>)
pm2 stop genie-bridge       # pausar de receber
```

> **Por que o wrapper `scripts/bridge.sh`?** (1) PM2 supervisiona melhor um processo
> em foreground; (2) o `genie serve` usa pidfile com `O_EXCL` → um restart pode deixar
> pidfile órfão e travar o próximo start, então o wrapper o remove antes de subir;
> (3) o bridge spawna `bun`/`omni` com PATH enxuto → o wrapper fixa o PATH.
>
> **WSL:** depende de `systemd=true` no `/etc/wsl.conf` (boot do systemd) e da distro
> WSL estar iniciada. Se o Windows encerrar a VM (todos os terminais WSL fechados), ela
> só religa ao reabrir o WSL — aí o systemd dispara e tudo sobe. Para 24/7 real, VPS.

### Recarregar mudanças no código

- **`worker.ts` / `qa-worker.ts` / `reminder.ts`** são spawnados **frescos a cada
  disparo** (`setsid bun run ...`) → mudanças valem no próximo link/pergunta, **sem
  matar nada**.
- **`server.ts` / `.mcp.json` / `AGENTS.md` / `settings.local.json`** são lidos no
  spawn do `claude` e ficam **em cache no processo do agente**. Para recarregar, mate
  o processo do agente — o próximo turno re-spawna relendo tudo:

```bash
pkill -f 'claude.*linkmind-agent'
```

> Turnos mortos no meio deixam processos `claude` **órfãos** vivos. Após `genie serve
> stop/start`, ou se um spawn engasgar no `--resume`, mate o órfão com o comando acima
> (a sessão fica em disco; o próximo turno re-spawna sozinho).

### Inspecionar o que aconteceu

```bash
genie agent log linkmind-agent | tail -20      # procure por  [C] mcp__knowledge__archive_link
tail -f tools/knowledge/worker.log             # log dos workers detached (captura/Gemini/omni send)
genie schedule list                            # confirma o reminder agendado
```

> Use `genie agent log` (mostra os eventos de tool), **NÃO** `genie agent observe`
> (os contadores ficam em 0 / "no linked session" — a view não está plugada no
> `claude` do bridge).

---

## Adaptações técnicas (o que um terceiro PRECISA trocar)

Tudo tem default, mas estes pontos quase sempre exigem ajuste num ambiente novo:

| O quê | Onde | Por quê |
|---|---|---|
| **`LINKMIND_OMNI_INSTANCE`** | `.env` (lido por `notify.ts`) | O default no código é o instance ID do ambiente de origem (`05415247-...`). **Troque pelo SEU** instance ID (de `omni instances list`), senão as mensagens saem pela instância errada. |
| **Caminhos absolutos no `.mcp.json`** | `agents/linkmind-agent/.mcp.json` | Estão hardcoded como `/home/lucsb/linkmind/tools/...`. O cwd do spawn é o dir do agente, então **caminho relativo quebra** — ajuste os caminhos para o seu `$HOME`/local do clone. |
| **`settings.local.json`** | `agents/linkmind-agent/.claude/` | **git-ignored**, não vem no clone. Recrie-o (passo 9) com `enableAllProjectMcpServers` + a lista de `permissions.allow`. |
| **Socket do Postgres** | `LINKMIND_PG_SOCKET` no `.env` | Default é `$XDG_RUNTIME_DIR/pgserve/.s.PGSQL.5432`. Se o seu uid não for 1000 ou o pgserve usar outro caminho, ajuste. |
| **`LINKMIND_OMNI_BIN`** | `.env` (opcional) | Só se o `omni` não estiver em `~/.bun/bin` / fora do PATH do bridge. |
| **Autenticação Gemini / Claude / Anthropic** | `~/.gemini/oauth_creds.json`, login do `claude` CLI, `ANTHROPIC_API_KEY` | São credenciais por máquina; não vêm no repo. |

Variáveis de ambiente completas (todas com default) estão documentadas em
[`.env.example`](.env.example):

```ini
# Postgres (socket unix trust)
LINKMIND_PG_SOCKET, LINKMIND_PG_DB (linkmind), LINKMIND_PG_USER (postgres)
# Omni / WhatsApp
LINKMIND_OMNI_INSTANCE  (TROCAR), LINKMIND_OMNI_BIN (opcional), LINKMIND_OMNI_TO (só teste headless)
# Lembretes
LINKMIND_REMINDER_DIAS (3), LINKMIND_REMINDER_MAX (3)
# Pesquisa web (F1.6, ainda não ativa)
BRAVE_API_KEY
```

> **Robustez de PATH já tratada no código:** o bridge spawna os MCP servers com um
> PATH enxuto (sem `~/.bun/bin`). Por isso `server.ts` e `notify.ts` **aumentam o
> PATH** e resolvem o `omni`/`bun` por caminho absoluto antes de spawná-los — para
> que o worker detached consiga mandar a mensagem de volta.

### Multi-usuário

O destino do card é **dinâmico**: cada número que escreve é um chat diferente. O
agente copia o `chat:` (JID, ex. `72254369050669@lid`) do contexto do turno e passa
para `archive_link(url, chat)`; a tool o repassa ao worker como `argv[3]`, então o
card volta para quem mandou o link — imune a outro usuário escrever no meio. O
`LINKMIND_OMNI_TO` no `.env` existe **apenas** para teste headless.

---

## As ferramentas do agente

Registro de uma tool = **2 arquivos** (ver `tools/README.md` para o passo a passo de
criar uma nova):

1. **`agents/linkmind-agent/.mcp.json`** — declara o MCP server (comando `bun run
   <caminho-absoluto>/server.ts`).
2. **`agents/linkmind-agent/.claude/settings.local.json`** — `enableAllProjectMcpServers:
   true` + `permissions.allow` com cada tool (`mcp__<server>__<tool>`).

> **NÃO** registre tools via `sdk.{mcpServers,allowedTools}` no `agent.yaml` — o bridge
> spawna o `claude` nativo **sem** `--mcp-config`/`--allowedTools`, então esse bloco é
> ignorado (só valia no modo SDK/print). Ver `.specs/features/F0.2-agente-real-tools/discovery.md`.

Tools disponíveis hoje:

| Tool | Server | Sync? | O que faz |
|---|---|---|---|
| `archive_link(url, chat)` | knowledge | async | Captura → resume (Gemini) → salva → manda card depois |
| `send_summary(assunto, chat)` | knowledge | sync | Reenvia o card de um link já salvo, por assunto |
| `ask_article(pergunta, assunto?, chat)` | knowledge | async | Q&A sobre o **texto completo** de um artigo salvo (via Gemini) |
| `fetch_web_content(url)` | web | sync | Extrai o texto de uma URL para resposta imediata (não salva) |
| `ping(echo?)` | hello | sync | Dummy de harness (só teste) |

O comportamento/gatilhos do agente (anti-textão, sempre fechar com `omni done`, quando
chamar cada tool) está em [`agents/linkmind-agent/AGENTS.md`](agents/linkmind-agent/AGENTS.md).

> Ao **adicionar uma tool nova**, atualize também o `AGENTS.md` — senão o agente não
> sabe que ela existe e recusa usá-la.

---

## Testes

Suíte `bun test` em `tools/knowledge` (deriva do PRD/specs; serve de guard/TDD):

```bash
cd tools/knowledge
bun test                 # tudo (a trilha de integração precisa do pgserve no ar)
bun test tests/unit      # só unit (offline: sem rede, Gemini, WhatsApp, DB) — gate rápido
bun test --coverage      # baseline de cobertura
```

- A trilha **unit** é offline e mocka o caro (Gemini ~140s, `fetch`, `omni send`).
- A trilha **integração** usa um DB descartável (`linkmind_test`), nunca o `linkmind` real.
- O **git hook de pre-push** (`.githooks/pre-push`) roda a trilha unit e **bloqueia o
  push** se falhar. Integração roda só se o socket do pgserve existir. Escape hatch:
  `SKIP_TESTS=1 git push`.
- Os 3 testes RED-por-design (F1.3 YouTube / F1.6 Brave / F1.7 release) são
  `test.failing` — marcam contratos de features ainda não implementadas e **não**
  quebram o gate.

---

## Decisões arquiteturais (ADRs)

As decisões de peso do LinkMind — e o **porquê** delas, incluindo as que reverteram
premissas iniciais — vivem como ADRs (Architecture Decision Records) em
[`docs/ADR/`](docs/ADR/). Cada uma segue o formato *contexto → decisão → consequências
→ status*. As principais:

| # | Decisão | Em uma linha |
|---|---|---|
| [0001](docs/ADR/0001-sem-docker-compose.md) | Sem Docker Compose | a stack é host/PM2 com auth/estado local; reprodutibilidade vem de `setup.sh`+`Makefile`+`make verify` |
| [0002](docs/ADR/0002-engine-claude-cli-nativo.md) | Engine = `claude` CLI nativo | o bridge spawna o CLI com `--resume`; o Agent SDK / `sdk.mcpServers` é ignorado nesse caminho |
| [0003](docs/ADR/0003-tools-mcp-stdio-efemeras.md) | Tools = MCP stdio efêmeras | registradas via `.mcp.json` + `settings.local.json`, spawnadas por turno — não são serviços long-running |
| [0004](docs/ADR/0004-resumo-via-gemini-cli.md) | Resumo = Gemini CLI | a sumarização é shell-out headless ao `gemini`, separada do modelo de conversa (`claude`) |
| [0005](docs/ADR/0005-persistencia-pgserve-socket-trust.md) | Persistência = pgserve socket-trust | Postgres por socket unix `trust` (Bun.sql `path`), não host/porta nem container |
| [0006](docs/ADR/0006-host-wsl2-ubuntu.md) | Host = WSL2/Ubuntu | os scripts oficiais da stack são bash/Linux; roda nativo no WSL, não Git Bash |

---

## Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| Tool nova não aparece / agente "não tem essa capacidade" | `.mcp.json`/`settings`/`AGENTS.md` em cache no processo | `pkill -f 'claude.*linkmind-agent'` e mande nova mensagem |
| `omni send` morre com código 127 no `worker.log` | `bun` não está no PATH do contexto detached | Confirme `~/.bun/bin` no PATH; o código já aumenta o PATH, mas verifique `LINKMIND_OMNI_BIN` |
| Card chega "no chat errado" | destino fixo em vez do JID dinâmico | Garanta que o agente passa o `chat:` do contexto a `archive_link` (já é o comportamento do `AGENTS.md`) |
| Resumo nunca chega, sem erro no chat | worker falhou em background | `tail tools/knowledge/worker.log` (captura/Gemini/DB) |
| `Connection closed` no Postgres | usou host/porta em vez de socket | Conexão é socket unix: `new SQL({ path, tls:false })` (já no `db.ts`) |
| `card`/`jsonb` vem como string | quirk do `Bun.sql` | É esperado — o código faz `JSON.parse` (ver `recall.ts`/`worker.ts`) |
| Q&A diz "salvo antes de guardar o texto completo" | node antigo com `content` NULL (pré-migration 003) | Reenvie o link para recapturar com o texto completo |
| Lembrete não disparou às 9h | máquina estava off (sem catch-up) | Limitação MVP local; confira `genie schedule list` e o `genie serve` no ar |

---

## Estado do projeto

MVP em andamento (M1). Fluxo principal validado E2E pelo WhatsApp: arquivar link →
card; recuperar resumo; Q&A sobre artigo; lembretes proativos. Roadmap detalhado,
estado atual e decisões em [`.specs/project/`](.specs/project/) (`ROADMAP.md`,
`STATE.md`) e o produto em [`docs/PRD.md`](docs/PRD.md).
