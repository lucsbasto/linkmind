# F1.9 — Setup reproduzível + docs + `make verify`

**Milestone:** M1 — MVP Núcleo (Captura + Pesquisa)
**Status:** 📝 SPEC (2026-06-02) — não iniciada.
**Depende de:** F0.1 (stack Omni/Genie/pgserve instalada) ✅ · F0.2 (tool harness `.mcp.json`) ✅ · F1.2/F1.4 (tools reais já registradas) ✅ · memórias `linkmind-sdd-resume`, `linkmind-postgres`, `linkmind-gemini-cli`, `linkmind-operacao-bridge`, `linkmind-genie-schedule` (runbooks operacionais que esta feature CONSOLIDA num só lugar versionado).
**Habilita:** Goal do PROJECT **"MVP validável por terceiros"** (≥3 usuários externos rodam o setup local e usam por 7 dias sem suporte). É o critério de "shippable" do M1.

> **Origem:** Goal do `PROJECT.md` ("Setup reproduzível via Docker Compose para validação por terceiros") + F1.9 do ROADMAP ("`docker-compose.yml` final + README + `make verify`"). **Esta spec REVISA o meio (Docker) e mantém o fim (reprodutibilidade verificável)** — ver "Tensão central" abaixo.

## Goal

Tornar o LinkMind **reproduzível por um terceiro técnico** a partir de um clone do repo:
um caminho de instalação documentado e, idealmente, scriptado, que termina num
**smoke test ponta-a-ponta verificável** (`make verify`) provando que a stack está de pé
e o pipeline de captura funciona — sem o autor presente para desempacar.

Resultado de aceite: um avaliador clona o repo, segue o `README`, roda `make setup`
(ou os passos manuais), pareia o WhatsApp **uma vez**, roda `make verify` e vê **verde**.

## Tensão central (decisão a confrontar nesta feature)

O PRD/PROJECT prometeu **Docker Compose**. A realidade da stack, descoberta no M0, é outra:

| Componente | Como roda hoje | Containerizável? |
|---|---|---|
| Omni (canal WhatsApp/NATS) | pacote global + **PM2** (`install.sh` oficial) | ❌ caminho oficial é host/PM2; Baileys precisa de estado de auth persistente do device |
| Genie (bridge/orquestrador) | auto-daemon (`genie serve`, pidfile `~/.genie/serve.pid`), **fora do PM2** | ❌ idem; scheduler in-process |
| pgserve/autopg (Postgres) | pacote global + PM2, **socket unix** `/run/user/1000/pgserve/.s.PGSQL.5432` (trust) | 🟡 dava pra trocar por Postgres em container, mas quebraria o socket-trust e o resto da stack que aponta pra ele |
| `claude` CLI (engine do agente) | binário nativo, **auth própria do login** (não API key) | ❌ login interativo; não vai pra container limpo |
| `gemini` CLI (motor de resumo) | binário nativo, **OAuth headless** (`~/.gemini/oauth_creds.json`) | ❌ idem OAuth |
| Tools (`fetch_web_content`, `knowledge`, …) | **MCP stdio**, projetos Bun isolados, **spawnados sob demanda** pelo agente | ❌ não são serviços long-running — são subprocessos do turno |

**Conclusão:** **quase nada do LinkMind é um serviço de longa duração que escrevemos** — as
tools são subprocessos efêmeros, e os 4 serviços base são pacotes globais com auth/estado
local (device WhatsApp, OAuth Gemini, login Claude). Um `docker-compose.yml` clássico
cobriria, no máximo, um Postgres — e ainda assim quebraria o socket-trust que o resto usa.
**Forçar Docker aqui é cerimônia que não aumenta reprodutibilidade** e contradiz a Decisão
de 2026-05-31 ("Docker Compose cobre apenas os serviços que escrevermos por cima").

**Decisão proposta (a confirmar com o usuário — ver Open questions):**
substituir "Docker Compose" por **script de setup + Makefile + smoke test**, que é o que
de fato torna a stack reproduzível neste desenho. Docker fica como **Deferred** (faria
sentido só num futuro deploy VPS multi-tenant, fora do v1).

## Scope

**In:**

1. **`README.md` raiz** — porta de entrada do repo: o que é, pré-requisitos (WSL2/Ubuntu, Bun, Node, PM2), e o caminho de setup passo-a-passo (consolidando os runbooks hoje espalhados em memórias e no `STATE.md`).
2. **`scripts/setup.sh`** — instalação scriptada e **idempotente** do que dá pra automatizar: instalar Omni/Genie/pgserve via scripts oficiais (se ausentes), `bun install` em cada tool, rodar as migrations (`tools/knowledge/migrate.ts`), registrar o agente, criar o schedule do reminder. Os passos **interativos/manuais** (login `claude`, OAuth `gemini`, pareamento QR do WhatsApp) ficam **claramente marcados como manuais** com instruções, não escondidos.
3. **`Makefile`** com alvos: `make setup` (chama `setup.sh`), `make start` (sobe PM2 + bridge), `make status` (health de cada peça), `make migrate`, `make verify` (smoke test), `make stop`.
4. **`make verify` — smoke test ponta-a-ponta** que checa, em ordem, e falha alto (exit ≠ 0) no primeiro problema:
   - serviços de pé (`omni-api`, `omni-nats`, `autopg-server` no `pm2 ls`; bridge via pidfile/`genie` health);
   - Postgres acessível pelo socket + tabela `knowledge_node` existe (migrations aplicadas);
   - `gemini -p` headless responde (OAuth válido);
   - `claude` CLI disponível;
   - instância WhatsApp `connected` (`omni instances whoami <id>`);
   - **pipeline real headless:** rodar `tools/knowledge/worker.ts` contra uma URL fixture → asserir que uma linha nova aparece em `knowledge_node` com `card`/`content` preenchidos. _(Não depende de mandar mensagem real no WhatsApp — testa o miolo determinístico; o envio E2E real fica como passo manual documentado.)_
5. **Limpeza de reprodutibilidade do repo:** mover os `tmux-*.log` da raiz pro `.gitignore` (ou apagar), garantir que `.gitignore` cobre `node_modules/`, `worker.log`, segredos (`.omni/config.json`, `~/.gemini`, keys). Confirmar que nenhum segredo está versionado.
6. **`.env.example`** documentando as variáveis configuráveis (socket do pgserve, instância/chat default do callback, `LINKMIND_REMINDER_DIAS`/`_MAX`, `MAX_CHARS`) — hoje espalhadas como defaults em código.

**Out (outras features / depois):**

- `docker-compose.yml` real (Deferred — só faz sentido num deploy VPS multi-tenant; ver Decisão 2026-05-31 e Future Considerations do ROADMAP).
- Auto-start no boot (systemd/PM2 startup) — **não é requisito MVP** (Decisão F0.1).
- Catch-up do reminder se a máquina estiver off às 9h (limitação MVP conhecida).
- CI (GitHub Actions) rodando o `verify` — anotar como ideia; o smoke test local é o aceite do v1.
- Provar com 2º número/usuário externo (critério P3 do ROADMAP) — não-bloqueante, oportunístico.

## Definition of Done

- [ ] `README.md` na raiz: visão de 1 parágrafo + pré-requisitos + caminho de setup completo (do clone ao primeiro card no WhatsApp), com passos manuais (login claude / OAuth gemini / QR WhatsApp) destacados.
- [ ] `scripts/setup.sh` idempotente: re-rodável sem quebrar; detecta o que já existe; instala tools (`bun install` por dir), roda migrations, registra agente + schedule. Passos manuais imprimem instrução em vez de falhar silenciosamente.
- [ ] `Makefile` com `setup/start/status/migrate/verify/stop` — cada um documentado no `make help`.
- [ ] `make verify` roda o smoke test completo e **sai 0 só se tudo passar**; em falha, aponta **qual** etapa quebrou e a dica de correção (reusar os runbooks: "bridge fora → `genie serve start --daemon --headless`", etc.).
- [ ] Smoke test inclui o **pipeline determinístico** (worker contra URL fixture → linha em `knowledge_node`), não só "serviços de pé".
- [ ] `.gitignore` cobre logs/tmux/`node_modules`/segredos; `tmux-*.log` saem da raiz; `git status` limpo num clone fresco após setup.
- [ ] `.env.example` lista todas as envs configuráveis com valores de exemplo e comentário.
- [ ] **Verificação por terceiro (proxy):** rodar o caminho completo numa árvore limpa (ou descrever o teste de mesa) e registrar o resultado no `STATE.md`.

## Design

### Estrutura nova

```
linkmind/
  README.md            # NOVO — porta de entrada
  Makefile             # NOVO
  .env.example         # NOVO
  scripts/
    setup.sh           # NOVO — instalação idempotente
    verify.sh          # NOVO — smoke test (chamado por `make verify`)
    lib.sh             # NOVO (opcional) — helpers de log/check compartilhados
```

### `make verify` — esqueleto (ordem importa: barato → caro, falha cedo)

```bash
check "pm2: omni-api/omni-nats/autopg-server online"   # pm2 jlist | jq
check "bridge no ar"                                    # pidfile ~/.genie/serve.pid + processo vivo
check "postgres socket + schema"                       # bun run -e "SELECT 1; \dt knowledge_node"
check "migrations aplicadas"                            # tabela knowledge_node + colunas content/chat existem
check "gemini headless"                                 # gemini -p "ok" → exit 0
check "claude CLI presente"                             # command -v claude
check "whatsapp connected"                              # omni instances whoami <id> | grep connected
check "pipeline determinístico"                         # bun run tools/knowledge/worker.ts <URL_FIXTURE> <CHAT_TESTE>
                                                        #   → poll SELECT count(*) subiu + card/content not null
                                                        #   → cleanup do node de teste
```

Cada `check` imprime `✓`/`✗`, e o `✗` traz a **ação corretiva** (mapa de erro→runbook).
Idempotente e sem efeitos colaterais permanentes (o node de teste é removido no fim).

### Caminho de setup (o que o README/`setup.sh` consolidam)

Hoje isto vive fragmentado em memórias + `STATE.md`. A feature **versiona num só lugar**:

1. **Pré-req host:** WSL2 + Ubuntu, Bun, Node 22, PM2, git, jq, tmux. _(setup.sh checa versões.)_
2. **Stack base:** `install.sh` do Omni + `get.automagik.dev/genie` + pgserve. `pm2 save`.
3. **Auth (manual, marcado):** `claude` login · `gemini` OAuth headless · `ANTHROPIC_API_KEY` no `~/.bashrc` (se aplicável).
4. **Bridge:** `genie serve start --daemon --headless` (auto-daemon, fora do PM2; pidfile `~/.genie/serve.pid`).
5. **Agente:** `genie agent register linkmind-agent --model sonnet --dir agents/linkmind-agent`; instância WhatsApp + `omni connect`.
6. **Pareamento WhatsApp (manual, marcado):** UM QR fresco, scan em <15s (cuidado anti-abuso — ver Blocker F0.1).
7. **Tools:** `bun install` em cada `tools/*/`; `.mcp.json` + `settings.local.json` já versionados.
8. **DB:** `bun run tools/knowledge/migrate.ts` (idempotente).
9. **Reminder:** `genie schedule create linkmind-nudge … --every "0 9 * * *" --timezone America/Sao_Paulo`.
10. **Verificar:** `make verify`.

### Mapa erro → runbook (reusado no `verify` e no README)

- bridge fora → `genie serve start --daemon --headless`
- pós-reboot → `pm2 resurrect` + subir bridge (não precisa matar órfão)
- tool nova não aparece → matar órfão `pkill -f 'claude.*linkmind-agent'` (relê `.mcp.json`/`server.ts`/`AGENTS.md` no próximo spawn)
- `omni` morre 127 no worker detached → PATH sem `~/.bun/bin` (já corrigido em `notify.ts`)
- WhatsApp não pareia → esfriar (anti-abuso), 1 tentativa limpa

## Validação

1. **Idempotência:** rodar `setup.sh` 2× seguidas → 2ª não quebra, não duplica schedule nem migration.
2. **`make verify` verde** com a stack sã.
3. **`make verify` vermelho dirigido:** derrubar o bridge → `verify` falha **naquele** check com a dica certa; subir de volta → verde.
4. **Repo limpo:** `git status` limpo num clone após setup (sem logs/tmux/segredos aparecendo).
5. **Teste de mesa do terceiro:** seguir o README do zero numa conta/dir limpos (ou simular) e anotar fricções no `STATE.md`.

## Test Cases

Os checks do `make verify` SÃO os test cases desta feature (smoke test ponta-a-ponta).

| ID | Tipo | Cenário | Esperado |
|---|---|---|---|
| VF-01 | smoke | `pm2 jlist` | `omni-api`, `omni-nats`, `autopg-server` = online |
| VF-02 | smoke | pidfile `~/.genie/serve.pid` + processo | bridge vivo |
| VF-03 | smoke | conexão socket pgserve + `\dt knowledge_node` | DB acessível, tabela existe |
| VF-04 | smoke | colunas `content`/`chat`/(F1.7)`status` presentes | migrations aplicadas |
| VF-05 | smoke | `gemini -p "ok"` | exit 0 (OAuth válido) |
| VF-06 | smoke | `command -v claude` | presente |
| VF-07 | smoke | `omni instances whoami <id>` | `connected` |
| VF-08 | smoke | `worker.ts` contra **HTML fixture local** | linha nova em `knowledge_node` com `card`/`content`; node de teste removido no fim |
| VF-09 | negativo | derrubar o bridge e rodar `make verify` | falha **naquele** check com a dica corretiva; subir de volta → verde |
| VF-10 | idempotência | rodar `setup.sh` 2× | 2ª não quebra, não duplica schedule/migration |
| VF-11 | higiene | `git status` num clone após setup | limpo (sem `tmux-*.log`/`worker.log`/segredos) |
| VF-12 | higiene | `git ls-files \| grep -iE 'config.json\|oauth\|\.env$'` | 0 segredos versionados; `.env.example` cobre todas as envs |

## Stories / tarefas

- **P0 — Higiene do repo:** `.gitignore` (tmux/logs/node_modules/segredos), tirar `tmux-*.log` da raiz, auditar que nenhum segredo está versionado (`git ls-files | grep -iE 'config.json|oauth|\.env$'`). `.env.example`.
- **P1 — `make verify` (smoke test):** `scripts/verify.sh` + alvo no Makefile. Começar pelos checks de serviço/DB/CLIs (baratos), depois o check de pipeline determinístico (worker → linha → cleanup). É a peça de maior valor — pode shippar antes do `setup.sh`.
- **P2 — `setup.sh` + Makefile completo:** instalação idempotente (o automatizável) + `start/status/migrate/stop`. Passos manuais marcados.
- **P3 — `README.md` raiz:** consolida o caminho de setup + mapa de runbook + como rodar `verify`. Linka pro `tools/README.md` e `docs/PRD.md`.
- **P4 — Teste de mesa + registro:** rodar o caminho completo em árvore limpa (ou descrever), anotar fricções e o resultado no `STATE.md`.

## Open questions

- **Docker: confirmar o descarte (vs. fim).** Proposta: **trocar Docker Compose por setup.sh+Makefile+verify** e mover Docker pra Deferred (só num deploy VPS futuro). → **PRECISA do OK do usuário** porque contraria a letra do PRD/ROADMAP (embora alinhe com a Decisão 2026-05-31). Se a banca exigir literalmente um `docker-compose.yml`, alternativa mínima: um compose só com Postgres + um doc explicando por que o resto é host/PM2 (mas isso reintroduz o atrito do socket-trust).
- **Escopo do `setup.sh`:** instalar a stack base (Omni/Genie/pgserve) de verdade vs. só **checar** que existe e instruir o usuário a rodar os scripts oficiais. → Proposto: **checar + instruir** os pesados (auth/QR), **automatizar** só o nosso (tools/migrations/schedule) — menos risco de o script quebrar em máquina alheia.
- **URL fixture do smoke test:** usar uma URL estável pública (risco: rede/site cai e o verify falha por motivo alheio) vs. servir um HTML local fixo (`file://`/server local) — mais hermético. → Proposto: **HTML fixture local** pro `verify` ser determinístico e offline-friendly; URL real fica no E2E manual.
- **`make verify` e o Gemini:** o check `gemini -p` real gasta ~quota e ~segundos. Manter no verify ou marcar como `make verify-full`? → Proposto: check leve (um prompt mínimo) no `verify`; pipeline com Gemini real no `verify-full`.
- **CI:** vale um GitHub Actions rodando um subset do verify (lint/migrations/parse) sem a stack viva? → Anotar como ideia pós-v1 (a stack viva não roda em CI sem WhatsApp/OAuth).
- **`.env` real:** hoje os defaults estão hardcoded (instância/chat do Lucas). Externalizar tudo pro `.env` agora vs. deixar default + override. → Proposto: `.env.example` documenta; código mantém default + override por env (já é o padrão do projeto).
