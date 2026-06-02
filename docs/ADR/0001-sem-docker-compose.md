# ADR 0001 — Sem Docker Compose; reprodutibilidade via setup.sh + Makefile + verify

**Status:** Aceito (2026-06-02)
**Contexto da feature:** F1.9 (setup reproduzível)

## Contexto

O PRD/PROJECT originais prometeram "Setup reproduzível via Docker Compose para validação
por terceiros". Ao montar a stack no M0, descobrimos que **quase nada do LinkMind é um
serviço de longa duração que escrevemos**:

| Componente | Como roda | Containerizável? |
|---|---|---|
| Omni (WhatsApp/NATS) | pacote global + PM2 | ❌ Baileys precisa de estado de auth do device |
| Genie (bridge) | auto-daemon, scheduler in-process | ❌ login/estado local |
| pgserve (Postgres) | pacote global, **socket unix trust** | 🟡 dava, mas quebraria o socket-trust |
| `claude` CLI | binário, **auth do login** (não API key) | ❌ login interativo |
| `gemini` CLI | binário, **OAuth headless** | ❌ OAuth |
| tools (`fetch`/`knowledge`) | **MCP stdio**, subprocessos do turno | ❌ não são long-running |

Um `docker-compose.yml` clássico cobriria, no máximo, um Postgres — e ainda quebraria o
socket-trust que o resto da stack usa.

## Decisão

**Trocar "Docker Compose" por `scripts/setup.sh` (idempotente) + `Makefile` + `make verify`
(smoke test).** É o que de fato torna a stack reproduzível neste desenho: o `setup.sh`
automatiza o que é nosso (deps das tools, migrations, registro de agente/schedule) e
**instrui** os passos manuais (login `claude`, OAuth `gemini`, pareamento QR); o
`make verify` prova que tudo está de pé com 9 checks determinísticos.

## Consequências

- ✅ Reprodutibilidade verificável sem cerimônia que não agrega (`make verify` é o aceite).
- ✅ Honra a realidade da stack (auth/estado local) em vez de forçá-la num container.
- ⚠️ Um avaliador ainda precisa instalar a stack base (scripts oficiais) e fazer os passos
  manuais de auth — documentados no README.
- ⚠️ Contraria a letra do PRD/ROADMAP; mitigado por esta decisão explícita.

## Alternativas consideradas

- **Compose só com Postgres + doc:** reintroduz o atrito do socket-trust sem ganho real.
- **Docker fica como Deferred** — faria sentido só num futuro deploy VPS multi-tenant.
