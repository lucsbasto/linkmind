# ADR 0004 — Resumo/Q&A = Gemini CLI (separado do modelo de conversa)

**Status:** Aceito (2026-06-01)
**Contexto da feature:** F1.4 (resumo Feynman + persistência), F1 Q&A (`ask_article`)

## Contexto

O LinkMind tem dois trabalhos de LLM bem diferentes: (a) **conversar/rotear** no WhatsApp
(curto, interativo, por turno) e (b) **resumir/responder sobre textos longos** (pesado,
~140s mesmo p/ texto curto, melhor desacoplado do turno). Usar o mesmo modelo do agente
(`claude`) para (b) acoplaria a sumarização à latência do turno e gastaria o orçamento do
engine de conversa.

## Decisão

A **sumarização (resumo Feynman JSON) e o Q&A sobre o artigo** são feitos por **shell-out
headless ao `gemini` CLI** (`gemini -p`), separados do `claude` que conduz a conversa.
O resumo roda no **worker desacoplado**; o Q&A roda num `qa-worker.ts` detached (também
~140s). Saída do Gemini é validada com zod (JSON estrito), com 1 retry e silenciamento de
ruído (ripgrep ausente / tentativa de IDE companion).

## Consequências

- ✅ Dois motores de LLM com propósitos distintos; o turno do WhatsApp não trava esperando resumo.
- ✅ Gemini CLI é grátis no tier pessoal (OAuth headless), bom p/ um MVP local.
- ⚠️ Depende do OAuth do `gemini` estar válido (`~/.gemini/oauth_creds.json`) — `make verify-full` exercita isso.
- ⚠️ `gemini -p` é lento (~segundos a ~140s) → tudo que usa Gemini é assíncrono (worker), nunca síncrono no turno.

## Alternativas consideradas

- **Usar o `claude` do agente também p/ resumir:** acopla latência e custo ao turno de conversa. Descartado.
- **API key do Gemini/Claude direto:** mais setup p/ terceiros; o CLI com OAuth/login é mais simples no MVP local.
