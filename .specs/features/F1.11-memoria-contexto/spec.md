# F1.11 — Memória e contexto entre mensagens

**Milestone:** M1 — MVP Núcleo (Captura + Pesquisa)
**Status:** 📝 SPEC (2026-06-02) — não iniciada.
**Depende de:** F0.1 (bridge `genie serve` que persiste a sessão do `claude`) ✅ · F0.2 (agente + `--resume`) ✅ · F1.4 (`knowledge_node` = memória de longo prazo) ✅ · F1.7 (estado de pendência `release`, se entrar — memória de "o que ficou na fila") 🟡.
**Habilita:** o diferencial de avaliação **"Memória e contexto entre mensagens"** — sair de "implícito e não medido" para **explícito, documentado e testado**, incluindo o edge case de isolamento entre usuários.

> **Origem:** diferencial dos requisitos do desafio ("Memória e contexto entre mensagens"). Hoje o LinkMind **já tem três memórias**, mas nenhuma é especificada como feature nem testada — e há um **risco de isolamento entre chats** não verificado.

## Tensão central (qual é a feature, de verdade)

O LinkMind **não tem zero memória** — tem três, em camadas distintas, e duas são "de graça"
pela arquitetura. A feature **não é construir memória do nada**; é **tornar explícito,
verificar e endurecer** o que já existe, e fechar o buraco real (isolamento por chat).

| Camada | O que guarda | Mecanismo (hoje) | Escopo | Persistência |
|---|---|---|---|---|
| **Curto prazo (conversacional)** | últimas trocas do diálogo — pronomes, "e o outro?", follow-up sem repetir o tema | **nativo:** o bridge spawna `claude --resume <sessionId>` por turno (Genie persiste `state.claudeSessionId`) | **⚠️ a verificar: por-chat ou por-agente?** | enquanto a sessão do `claude` viver |
| **Longo prazo (conhecimento)** | tudo que o usuário salvou: título, tópico, card, texto completo, data | tabela `knowledge_node` (Postgres, socket trust) | por `chat` (coluna `chat`) | permanente (DB) |
| **Temporal (revisão espaçada)** | o que já foi lido / quantos lembretes mandamos | colunas `last_recalled_at`, `reminder_count`, `last_reminder_at` | por nó/chat | permanente (DB) |

**Leitura da feature:** v1 = **(A) formalizar + medir as 3 camadas + corrigir o isolamento**,
NÃO (B) introduzir um store de memória novo (vetorial, embeddings, "perfil do usuário" rico).
Motivo: o que falta pra pontuar o diferencial é **prova** de que o contexto sobrevive entre
mensagens e **não vaza** entre usuários — não um segundo sistema de memória.

## Goal

Garantir e **provar** que:
1. O agente mantém **contexto conversacional** entre mensagens do mesmo chat (follow-up,
   pronome, "e o outro?") sem o usuário repetir o assunto.
2. Esse contexto é **isolado por chat** — dois números de WhatsApp **nunca** veem o histórico
   um do outro (correção do risco multi-usuário).
3. A **memória de longo prazo** (`knowledge_node`) é recuperável por tópico entre sessões
   diferentes — inclusive após reboot/derrubada da sessão do `claude`.
4. Tudo isso está **documentado** (como funciona cada camada) e **coberto por teste**.

## Risco central a confrontar (o buraco real)

O bridge usa `claude --resume <sessionId>`. **Se o `sessionId` for único por agente** (e não
por chat/instância), então a memória de curto prazo seria **compartilhada entre todos os
usuários** → vazamento de contexto entre números diferentes (um usuário veria referências à
conversa de outro). **Isto precisa ser verificado empiricamente como passo P0** — é o achado
de maior valor desta spec e potencialmente um bug de privacidade.

- Se **já é por-chat** → ótimo, só documentar + testar o isolamento como gate de regressão.
- Se é **por-agente** → corrigir: o bridge/Genie precisa mapear `sessionId` por `chat` (JID).
  Investigar se o Genie expõe isso (config da instância) ou se precisamos de um workaround
  (ex.: sessão por instância WhatsApp, já que cada usuário pode ser uma instância; ou um
  prefixo/namespace por chat). Anotar a descoberta no `STATE.md` e no `discovery.md`.

## Scope

**In:**
1. **Descoberta + documentação** do mecanismo de sessão do `claude` no caminho do bridge:
   onde mora o `sessionId`, qual seu escopo (chat vs. agente vs. instância), o que acontece
   no reboot/`genie serve stop/start` (a sessão sobrevive? engasga? — ver F0.2 nota do resume).
2. **Teste de continuidade conversacional** (multi-turn no mesmo chat): mandar A, depois um
   follow-up que só faz sentido com A no contexto, e asserir que a resposta usou A.
3. **Teste de isolamento entre chats** (o gate de privacidade): dois chats distintos, garantir
   que o follow-up de um não enxerga o histórico do outro.
4. **Teste de memória de longo prazo entre sessões:** salvar via `archive_link`, **derrubar a
   sessão do `claude`** (matar órfão / reciclar bridge), e recuperar por `send_summary` —
   provando que o conhecimento sobrevive à perda da memória curta.
5. **Seção "Memória" no `README`/docs** (linka com F1.9): as 3 camadas, o que cada uma garante,
   e a fronteira (o que o LinkMind **não** lembra — ex.: não infere perfil/preferências em v1).
6. Correção do isolamento por chat **se** o P0 mostrar que está compartilhado.

**Out (ideias / M2):**
- **Perfil do usuário / preferências aprendidas** ("você costuma salvar sobre React") — memória
  semântica rica; anotar como Deferred.
- **Busca semântica / embeddings** sobre o `knowledge_node` (hoje é ILIKE por tópico/título).
- **Resumo de conversa de longo prazo** (comprimir histórico antigo num sumário) — só faria
  sentido se a janela do `claude` estourar; fora do v1.
- **Memória de roteamento multi-turno** ("e o outro?" referente a uma lista anterior) — overlap
  com F1.1 Out; tratar junto se entrar.

## Design

### As 3 camadas, explicitadas

```
WhatsApp msg ──► Omni ──► Genie bridge ──► claude --resume <sessionId>   [CURTO PRAZO: diálogo]
                                                    │
                                                    ├─ archive_link / send_summary / ask_article
                                                    ▼
                                            knowledge_node (Postgres)     [LONGO PRAZO: conhecimento]
                                            + last_recalled_at/reminder_*  [TEMPORAL: revisão]
```

- **Curto prazo** é responsabilidade do **Genie/`claude`** (não escrevemos — herdamos). Nossa
  tarefa é **descobrir o escopo do `sessionId`** e **testar** continuidade + isolamento.
- **Longo prazo** é **nosso** (`knowledge_node`), já implementado; aqui só **provamos** que
  recupera entre sessões e **documentamos** como memória.
- **Temporal** já existe (F1 reminder); entra na doc como a 3ª camada.

### Verificação do escopo do `sessionId` (P0 — o experimento)

1. Inspecionar como o Genie persiste a sessão: procurar `state.claudeSessionId` / pidfile /
   arquivo de estado da instância (ver `discovery.md` F0.1 linha ~383: `state.claudeSessionId`).
2. **Experimento de 2 chats:** se houver 2º número/instância, mandar contexto distinto em cada
   e cruzar. Sem 2º número: simular dois `chat` JIDs diferentes no caminho headless e inspecionar
   se o `--resume` aponta pro mesmo `sessionId`.
3. Registrar o veredito (isolado ✅ / compartilhado ❌ → vira tarefa de correção) no `STATE.md`.

### Continuidade conversacional — como testar sem flakiness

O engine é o `claude` (não-determinístico). O teste afirma **uso do contexto**, não texto exato:
- Turno 1: "salvei um artigo sobre useEffect" (ou estado conhecido no DB).
- Turno 2: "me manda **ele**" (pronome, sem repetir "useEffect") → asserir que `send_summary`
  foi chamado com o assunto certo (visível no `genie agent log`), não um "de qual?".
- Modo barato: `claude -p` headless reusando o mesmo `sessionId` fora do bridge, se viável;
  E2E real como calibração (igual estratégia da F1.1).

## Definition of Done

- [ ] **Escopo do `sessionId` descoberto e documentado** (por-chat / por-agente / por-instância),
      com a evidência no `discovery.md` desta feature e o veredito no `STATE.md`.
- [ ] **Isolamento entre chats verificado:** teste prova que o histórico de um chat não vaza pro
      outro. Se hoje vaza → corrigido (sessão namespaced por chat) e re-testado.
- [ ] **Continuidade conversacional testada:** follow-up com pronome/"ele" resolve pro alvo certo
      (tool correta no `genie agent log`), sem pedir o assunto de novo.
- [ ] **Memória longa entre sessões testada:** salvar → derrubar a sessão do `claude` → recuperar
      por `send_summary` funciona (o conhecimento não depende da memória curta).
- [ ] **Doc de memória** (seção no README ou `docs/`): as 3 camadas, garantias e fronteiras
      (o que NÃO lembramos em v1). Linkada pela F1.9.
- [ ] Casos viram fixtures/asserts reusáveis no harness de testes (F1.10), onde aplicável.

## Validação

1. **Continuidade:** sequência de 2 turnos no mesmo chat com referência implícita → resolve.
2. **Isolamento:** 2 chats, contexto cruzado → **não** vaza (gate de privacidade).
3. **Persistência longa:** sobrevive a `pkill -f 'claude.*linkmind-agent'` + novo turno.
4. **Pós-reboot:** após `pm2 resurrect` + bridge, a recuperação por tópico continua funcionando.
5. **Fronteira honesta:** o agente **não finge** lembrar de preferências que não guarda (anti-
   alucinação; alinhado com F1.8) — se perguntado "do que eu gosto?", responde a verdade.

## Test Cases

Tipo: **e2e** = pelo bridge real (confere tool no `genie agent log`); **integração** = caminho
headless do worker/DB; **eval** = continuidade via `claude -p` reusando sessão.

| ID | Tipo | Cenário | Esperado |
|---|---|---|---|
| MC-01 | eval/e2e | Turno1 "salvei sobre useEffect"; Turno2 "me manda ele" | `send_summary("useEffect")` — usou o contexto, não pediu o assunto |
| MC-02 | eval/e2e | Turno1 define um tema; Turno2 "e o resumo disso?" | recupera o tema do turno 1 (pronome resolvido) |
| MC-03 | e2e | **isolamento:** chat A fala de X; chat B pergunta "qual era mesmo?" | B **não** sabe de X (sem vazamento entre chats) |
| MC-04 | integração | `archive_link` salva; depois `send_summary` em **nova sessão** | recupera o card (memória longa independe da curta) |
| MC-05 | integração | matar a sessão do `claude` (`pkill`) entre salvar e recuperar | recuperação ainda funciona |
| MC-06 | integração | após `pm2 resurrect` + bridge, recuperar por tópico | funciona (DB sobrevive ao reboot) |
| MC-07 | eval | "do que eu costumo gostar / meu nome?" (não guardamos) | responde a verdade, **não** inventa perfil |
| MC-08 | descoberta | inspeção do escopo do `sessionId` no estado do Genie | veredito documentado (chat/agente/instância) |

## Stories / tarefas

- **P0 — Descoberta do escopo do `sessionId`** (o experimento de isolamento): inspecionar o
  estado do Genie, rodar o cruzamento de 2 chats, **decidir se há bug de vazamento**. É a peça
  de maior valor e pode mudar o resto da spec.
- **P1 — Correção do isolamento (condicional):** só se P0 achar compartilhamento — namespacing
  da sessão por `chat`/instância.
- **P2 — Testes de continuidade + isolamento + persistência longa** (MC-01..MC-06), plugados no
  harness da F1.10.
- **P3 — Doc de memória:** seção no README/`docs/` (as 3 camadas + fronteiras), linkada pela F1.9.

## Open questions

- **Escopo real do `sessionId` (P0):** por-chat, por-agente ou por-instância? **Bloqueia o
  desenho do isolamento.** Hipótese a confirmar no código do bridge/estado do Genie.
- **Sem 2º número p/ o teste de isolamento:** dá pra provar isolamento de forma confiável só com
  o caminho headless (2 JIDs simulados), ou MC-03 fica como teste manual documentado até haver
  um 2º número? → Proposto: provar o que der headless + marcar o E2E real como manual.
- **Vale uma 4ª camada (perfil leve do usuário)?** Ex.: lembrar o primeiro nome / temas
  frequentes. Pequeno e vistoso, mas é memória nova (vai pra Out/M2 por ora). Confirmar se a
  banca valoriza ao ponto de entrar no v1.
- **Continuidade medível sem flaky:** asserir pela **tool chamada** (determinístico no log) em
  vez do texto da resposta — confirmar que cobre o que a avaliação quer ver.
