# F1.3 — Tool `get_youtube_transcript` (legendas de vídeo)

**Milestone:** M1 — MVP Núcleo (Captura + Pesquisa)
**Status:** 📝 SPEC (2026-06-02) — não iniciada. ⚠️ TODO aberto desde o início: confirmar lib de transcript p/ Bun/Linux.
**Depende de:** F0.2 (tool harness `.mcp.json`) ✅ · F1.4 (`archive_link` + worker + `summarizeFeynman` — o resumo Feynman reusa o mesmo motor; YouTube só troca a fonte de captura) ✅.
**Habilita:** paridade da promessa do produto ("links **web e YouTube**") — hoje o `AGENTS.md` declara explicitamente que YouTube **não existe** (anti-alucinação). Esta feature remove essa lacuna.

> **Origem:** ROADMAP F1.3 — "Extração de legendas (auto-geradas ou manuais); detecção de idioma e fallback; tratamento de vídeos sem legenda." PROJECT lista `youtube-transcript` ou equivalente como dependência.

## Goal

Capturar a **transcrição** de um vídeo do YouTube (legenda manual ou auto-gerada) e entregar
o texto limpo no **mesmo formato** que o `extractArticle` da web já entrega (`ExtractResult`),
para que o pipeline de arquivamento (resumo Feynman + persistência + card no WhatsApp) funcione
para vídeos **sem reescrever nada do worker**. Usuário manda um link do YouTube → recebe o
mesmo card Feynman que recebe de um artigo.

## Arquitetura: encaixar no pipeline existente, não criar um paralelo

O fluxo de arquivamento já é: `archive_link(url)` → `worker.ts` → `extractArticle(url)` →
`summarizeFeynman(text)` → persist → card. **YouTube só muda a etapa de captura.** Decisão:

- Criar `tools/knowledge/youtube.ts::getTranscript(url): Promise<ExtractResult>` — **mesmo
  shape** de `extract.ts` (`{ ok, url, title?, text?, length?, error? }`).
- No `worker.ts`, detectar host YouTube (`youtube.com`/`youtu.be`) e **rotear a captura**:
  `isYouTube(url) ? getTranscript(url) : extractArticle(url)`. O resto do worker é idêntico.
- `archive_link` continua a **única** tool de arquivamento (web ou vídeo) — o usuário não
  precisa saber a diferença. _(Alternativa rejeitada: uma tool MCP `get_youtube_transcript`
  separada exposta ao agente — adiciona superfície e exige o agente escolher; o roteamento
  por host é determinístico e melhor no worker.)_

> **Nota de roteamento:** isso também simplifica a F1.1 — não há nova intenção; "manda um
> link do YouTube pra guardar" = `ARQUIVAR_LINK`, e o worker decide a captura.

## Scope

**In:**
1. `youtube.ts`: extrair `videoId` da URL (formas `watch?v=`, `youtu.be/`, `shorts/`, com query extra), buscar a transcrição, concatenar os cues em texto corrido, devolver `ExtractResult`.
2. **Detecção de idioma + fallback:** preferir legenda manual no idioma do vídeo; cair p/ auto-gerada; cair p/ outro idioma disponível (anotar qual). `title` do vídeo no resultado.
3. **Tratamento de erros** no mesmo estilo `ok:false` + `error:<categoria>`: `no_transcript` (vídeo sem legenda), `video_unavailable` (privado/removido/region-locked), `not_a_video` (URL YouTube sem id de vídeo), `fetch_failed`, `timeout`.
4. Roteamento por host no `worker.ts` (+ `isYouTube`).
5. Limites: `MAX_CHARS` p/ o texto enviado ao Gemini (mesma lógica do `summarize.ts`); timeout de captura.
6. Atualizar `AGENTS.md`: remover "YouTube não existe", incluir que link de YouTube é arquivado igual (sem nova tool exposta — só ampliar o gatilho do `archive_link` p/ "link web **ou YouTube**").

**Out:**
- Download de áudio/vídeo + STT (transcrição própria) — fora de escopo (áudio foi removido do PRD). Só legendas existentes.
- Capítulos/timestamps estruturados no card — v1 usa só o texto corrido.
- Playlists / canais — só vídeo único.
- Tradução da legenda — v1 usa o idioma disponível e anota qual.

## Decisão de biblioteca (⚠️ o risco aberto do projeto)

O TODO permanente do `STATE.md`: **confirmar uma lib de transcript que funcione sob Bun no
Linux.** Opções a avaliar no P0 (spike curto):

1. **`youtube-transcript` (npm)** — leve, sem API key; raspa a página/endpoint de legendas.
   Risco: quebra quando o YouTube muda o HTML; pode falhar sob Bun (depende de `fetch`/parse).
2. **`youtubei.js` (YouTube.js)** — mais robusto/mantido, fala a InnerTube API; cobre legendas,
   título, metadados. Mais pesado. Melhor candidato se o leve falhar.
3. **YouTube Data API v3 (oficial)** — precisa de API key + cota; `captions.download` exige
   OAuth do **dono** do vídeo → **inviável** pra vídeos de terceiros. Descartar p/ legendas.
4. **Endpoint `timedtext` direto** (sem lib) — montar a chamada `https://www.youtube.com/api/
   timedtext` a partir do `videoId` + lista de tracks. Zero-dep, mas frágil e não-documentado.

**Plano:** spike no P0 testando (1) e (2) sob Bun/Linux com 3 vídeos (com legenda manual, só
auto-gerada, sem legenda). Adotar o mais robusto que rode limpo. **Critério de aceite do
spike:** extrair a transcrição de um vídeo real, headless, sob `bun run`, sem browser.

## Definition of Done

- [ ] **Spike de lib resolvido** (P0): uma lib/método escolhido que roda sob Bun/Linux headless, com evidência (3 vídeos: manual / auto / sem-legenda).
- [ ] `getTranscript(url)` devolve `ExtractResult` (`ok:true` com `text`+`title`+`length`; `ok:false` com `error` categorizado).
- [ ] Parsing de `videoId` cobre `watch?v=`, `youtu.be/`, `shorts/`, params extras.
- [ ] Idioma: prefere manual → auto-gerada → outro idioma (anota); vídeo sem legenda → `no_transcript` (não trava).
- [ ] `worker.ts` roteia por host (YouTube → transcript; resto → `extractArticle`); resto do pipeline intacto.
- [ ] `AGENTS.md` atualizado (YouTube deixa de ser "não existe"; `archive_link` cobre web **e** YouTube).
- [ ] **E2E WhatsApp:** mandar um link de YouTube → ack curto → ~1-2 min → card Feynman do vídeo no chat + linha em `knowledge_node` (com `content` = transcrição).
- [ ] Erros validados: vídeo privado → aviso curto; vídeo sem legenda → aviso curto ("esse vídeo não tem legenda pra eu ler").

## Validação

1. **Spike standalone:** `bun run youtube.ts <url>` → texto da transcrição p/ os 3 tipos.
2. **Pipeline:** `archive_link(<url-youtube>, chat)` → worker captura via transcript → card salvo coerente com o vídeo.
3. **Robustez:** privado/removido → `video_unavailable`; sem legenda → `no_transcript`; URL YouTube sem id → `not_a_video`.
4. **E2E WhatsApp** (acima).

## Test Cases

| ID | Tipo | Cenário | Esperado |
|---|---|---|---|
| YT-01 | unit | `videoId("https://youtube.com/watch?v=ABC123")` | `ABC123` |
| YT-02 | unit | `videoId("https://youtu.be/ABC123")` | `ABC123` |
| YT-03 | unit | `videoId("https://youtube.com/shorts/ABC123")` | `ABC123` |
| YT-04 | unit | URL com params extras (`&t=30s&list=…`) | `ABC123` (ignora o resto) |
| YT-05 | unit | URL do YouTube sem id de vídeo (canal/home) | `error: not_a_video` |
| YT-06 | integração | vídeo com legenda **manual** | `ok:true`, `text` não-vazio, `title` preenchido |
| YT-07 | integração | vídeo só com **auto-gerada** | `ok:true`, anota idioma usado |
| YT-08 | integração | vídeo **sem** legenda | `error: no_transcript` (não trava) |
| YT-09 | integração | vídeo **privado/removido** | `error: video_unavailable` |
| YT-10 | unit | `worker` recebe host YouTube vs web | roteia `getTranscript` vs `extractArticle` |
| YT-11 | e2e | link YouTube no WhatsApp | card Feynman + linha `knowledge_node` com `content`=transcrição |
| YT-12 | unit | transcrição > `MAX_CHARS` | trunca p/ o Gemini, não quebra |

## Stories / tarefas

- **P0 — Spike de lib** (⚠️ desbloqueador): testar `youtube-transcript` e `youtubei.js` sob Bun/Linux com 3 vídeos; escolher; registrar a decisão.
- **P1 — `youtube.ts`:** parse de `videoId` + captura + idioma/fallback + mapa de erros → `ExtractResult`. Harness standalone (`if import.meta.main`).
- **P2 — Roteamento no worker:** `isYouTube` + branch de captura; sem mexer no resto.
- **P3 — AGENTS.md + E2E:** ampliar o gatilho do `archive_link`; matar órfãos; E2E pelo WhatsApp.
- **P4 — README:** anotar a lib escolhida, os erros, como testar.

## Open questions

- **Lib (o grande risco):** ver "Decisão de biblioteca". Resolver no P0. Se nenhuma rodar limpo sob Bun, fallback = spawnar um pequeno script Node (`youtubei.js` roda bem em Node) via `Bun.spawn` — mesma pegada de shell-out do `gemini`.
- **Tool exposta vs roteamento no worker:** proposto **roteamento no worker** (sem nova tool MCP). Confirmar — se o usuário preferir uma tool explícita `get_youtube_transcript` (mais visível como "integração construída" p/ avaliação), dá pra expor AMBOS: a tool standalone + o roteamento automático no archive.
- **Transcrição longa (vídeo de 1h):** pode estourar `MAX_CHARS` do Gemini. v1 trunca como já faz o `summarize.ts` (16k). Anotar: chunking/resumo hierárquico = ideia futura.
- **Legenda auto-gerada é ruidosa** (sem pontuação): o Feynman do Gemini tolera? Validar no P1; se o card sair ruim, pré-limpar o texto (juntar linhas, remover `[Música]`).
