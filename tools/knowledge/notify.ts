/**
 * F1.4 — Envio e formatação compartilhados (worker de arquivamento + tool de
 * recuperação `send_summary`). Centraliza o `omni send` e os templates de card.
 *
 * ROBUSTEZ DE PATH: tanto o worker (detached) quanto o MCP server `knowledge`
 * podem rodar sob um PATH enxuto (o bridge spawna sem `~/.bun/bin`). O `omni` é
 * script com shebang `#!/usr/bin/env bun` → sem `bun` no PATH morre com 127.
 * Por isso resolvemos o binário por caminho absoluto E aumentamos o PATH ao
 * spawná-lo. Assim o envio funciona em qualquer um dos dois contextos.
 */
import type { FeynmanCard } from "./summarize.ts";

const OMNI_INSTANCE =
  process.env.LINKMIND_OMNI_INSTANCE ?? "05415247-c598-4a2b-832b-f127d4410e10";

const BUN_BIN = `${process.env.HOME ?? "/home/lucsb"}/.bun/bin`;
const OMNI_BIN =
  process.env.LINKMIND_OMNI_BIN ?? Bun.which("omni") ?? `${BUN_BIN}/omni`;

/** Manda um texto pro chat `to` (JID) via `omni send`. Retorna se deu certo. */
export async function sendWhatsApp(to: string, text: string): Promise<boolean> {
  const proc = Bun.spawn(
    [OMNI_BIN, "send", "--instance", OMNI_INSTANCE, "--to", to, "--text", text],
    {
      stdout: "pipe",
      stderr: "pipe",
      // PATH aumentado: o shebang `env bun` do omni precisa achar o bun.
      env: { ...process.env, PATH: `${BUN_BIN}:${process.env.PATH ?? ""}` },
    },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    console.error(`[notify] omni send FALHOU (código ${code}) bin=${OMNI_BIN}`);
    console.error(`[notify] stdout: ${out.trim()}`);
    console.error(`[notify] stderr: ${err.trim()}`);
    return false;
  }
  console.error(`[notify] omni send OK → ${to}`);
  return true;
}

/** Card completo (resumo Feynman) — usado no reenvio sob demanda. */
export function formatCard(card: FeynmanCard, title: string | undefined, url: string): string {
  const pilares = card.pilares.map((p) => `• ${p}`).join("\n");
  return [
    `🧠 *${title ?? card.topico}*`,
    ``,
    `💡 ${card.ideia_central}`,
    ``,
    `📌 *Pilares:*`,
    pilares,
    ``,
    `🔧 *Aplicação:* ${card.aplicacao}`,
    ``,
    `🏷️ ${card.topico}`,
    `🔗 ${url}`,
  ].join("\n");
}

/**
 * Confirmação curta enviada ao terminar o arquivamento — NÃO o card cheio (pra não
 * poluir o chat). O card completo fica salvo no banco e é reenviado só sob demanda
 * via `send_summary` (que usa `formatCard`).
 */
export function formatConfirmation(card: FeynmanCard, title: string | undefined): string {
  return [
    `🧠 *${title ?? card.topico}*`,
    `salvo ✅ — manda "me manda o resumo" se quiser o card completo`,
  ].join("\n");
}
