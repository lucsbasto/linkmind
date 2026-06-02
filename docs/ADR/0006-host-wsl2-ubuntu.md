# ADR 0006 — Host runtime = WSL2 + Ubuntu

**Status:** Aceito (2026-05-31)
**Contexto da feature:** F0.1 (setup da stack base)

## Contexto

A stack base (Omni, Genie, pgserve) é instalada por **scripts oficiais em bash**
(`install.sh` do Omni, `get.automagik.dev/genie`) e é testada em **Linux**. O ambiente do
autor é Windows. Rodar em Git Bash nativo arriscava edge cases de Windows (locks de
arquivo em DrvFs `/mnt/c`, sockets unix, paths) que os repos oficiais não cobrem.

## Decisão

Rodar todo o stack em **WSL2 + Ubuntu**, com o workspace **nativo no Linux** (`~/linkmind`),
não em `/mnt/c`. Toolchain: Node 22, Bun, PM2, git, jq, tmux. O usuário do host (`lucsb`)
tem sudo NOPASSWD; comandos sempre a partir de `~/linkmind` (workspace é por-diretório).

## Consequências

- ✅ Os scripts oficiais bash rodam sem adaptação; sockets unix e locks funcionam como no Linux.
- ✅ Evita a classe de bugs de DrvFs (`/mnt/c`) com locks/sockets.
- ⚠️ Setup inicial mais longo (instalar WSL + Ubuntu, ~30–45 min).
- ⚠️ Se o PC estiver desligado, o LinkMind não responde nem manda lembretes (limitação do "MVP 100% local" — ver Known Tensions; mitigação futura = VPS).

## Alternativas consideradas

- **Git Bash nativo no Windows:** risco de edge cases não testados pelos repos oficiais. Descartado.
- **VPS desde já:** resolve o "PC ligado", mas adia o MVP e adiciona custo/infra; deferido até validar com terceiros.
