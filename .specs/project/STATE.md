# Project State

**Last updated:** 2026-06-01

## Next Step

**Feature:** F0.1 — Setup Omni + Genie + pgserve com agente stub
**Phase:** Execute → story P1 "Stack instalada e supervisionada"
**Action:** Instalar WSL2 + Ubuntu no Windows 11. Depois rodar os scripts oficiais de Omni (`install.sh`), Genie (`get.automagik.dev/genie`) e `pgserve@^2`, registrar com PM2.
**Blocked by:** Nada para esta primeira sub-tarefa. (Anthropic API key vira bloqueio só quando avançar para a story "Agente stub respondendo".)
**Definition of done:** `pm2 ls` em WSL mostra `omni`, `genie`, `pgserve` no status `online`; `genie doctor` aponta pgserve e NATS acessíveis.

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
