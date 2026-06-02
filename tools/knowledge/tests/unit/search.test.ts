/**
 * F1.6 — unit de `search.ts` (pesquisa web via Gemini grounding).
 *
 * Motor trocado de Brave → Gemini CLI nativo (decisão 2026-06-02): `researchWeb(query)`
 * faz um `gemini -p` com grounding e devolve um card Feynman + fontes. O runner do
 * Gemini é injetável (`deps.runGemini`) → os testes mockam a saída SEM spawnar o
 * binário nem tocar a rede.
 *
 * CONTRATO:
 *   export async function researchWeb(
 *     query: string,
 *     deps?: { runGemini?: (prompt: string, stdin: string) => Promise<string> },
 *   ): Promise<
 *     | { ok: true;  card: FeynmanCard; sources: { title: string; url: string }[] }
 *     | { ok: false; error: string }
 *   >
 *   - query vazia → { ok:false, error:"query vazia" } SEM chamar o Gemini.
 *   - JSON válido (4 chaves do card + fontes) → { ok:true, card, sources }.
 *   - JSON inválido/sem chaves 2× (com retry) → { ok:false, error:"gemini_bad_json: ..." }.
 *   - 1 retry: 1ª saída ruim, 2ª boa → ok.
 */
import { describe, test, expect } from "bun:test";

let mod: any = null;
try {
  mod = await import("../../search.ts");
} catch {
  /* guard abaixo reporta RED limpo se o módulo sumir */
}

const CARD_OK = {
  ideia_central: "MCP é um protocolo aberto para conectar LLMs a ferramentas.",
  pilares: ["Padroniza tools via servidores", "Transporte stdio/HTTP"],
  aplicacao: "Use MCP para expor suas ferramentas a um agente.",
  topico: "Model Context Protocol",
  fontes: [
    { titulo: "Site oficial", url: "https://modelcontextprotocol.io" },
    { titulo: "Spec", url: "https://modelcontextprotocol.io/spec" },
  ],
};

/** runGemini falso: devolve, em sequência, as saídas dadas (uma por chamada). */
function fakeGemini(...outputs: string[]): {
  run: (p: string, s: string) => Promise<string>;
  calls: () => number;
} {
  let i = 0;
  return {
    run: async () => outputs[Math.min(i++, outputs.length - 1)] ?? "",
    calls: () => i,
  };
}

describe("F1.6 search.ts — guard de existência", () => {
  test("SR-00 search.ts implementado e exporta researchWeb (F1.6 guard)", () => {
    expect(mod, "search.ts não implementado — F1.6").not.toBeNull();
    expect(typeof mod?.researchWeb, "researchWeb ausente — F1.6").toBe("function");
  });
});

describe("F1.6 researchWeb — mock do Gemini (sem rede/spawn)", () => {
  test("SR-01 saída JSON válida → { ok:true, card, sources } parseado", async () => {
    if (!mod) return;
    const g = fakeGemini(JSON.stringify(CARD_OK));
    const res = await mod.researchWeb("o que é MCP", { runGemini: g.run });
    expect(res.ok).toBe(true);
    expect(res.card.topico).toBe("Model Context Protocol");
    expect(res.card.pilares.length).toBe(2);
    // fontes: titulo→title, descarta sem url
    expect(res.sources.length).toBe(2);
    expect(res.sources[0]).toEqual({ title: "Site oficial", url: "https://modelcontextprotocol.io" });
    expect(g.calls()).toBe(1); // acertou de primeira, sem retry
  });

  test("SR-01b tolera cercas ```json e prefácio ao redor do JSON", async () => {
    if (!mod) return;
    const ruidoso = "Aqui está:\n```json\n" + JSON.stringify(CARD_OK) + "\n```\n";
    const g = fakeGemini(ruidoso);
    const res = await mod.researchWeb("mcp", { runGemini: g.run });
    expect(res.ok).toBe(true);
    expect(res.card.topico).toBe("Model Context Protocol");
  });

  test("SR-04 query vazia → error:query vazia (NÃO chama o Gemini)", async () => {
    if (!mod) return;
    const g = fakeGemini(JSON.stringify(CARD_OK));
    const res = await mod.researchWeb("   ", { runGemini: g.run });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("query vazia");
    expect(g.calls(), "query vazia não deve chamar o Gemini").toBe(0);
  });

  test("SR-08 JSON inválido 2× (com retry) → error:gemini_bad_json", async () => {
    if (!mod) return;
    const g = fakeGemini("não é json", "ainda não é json");
    const res = await mod.researchWeb("qualquer", { runGemini: g.run });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/^gemini_bad_json/);
    expect(g.calls()).toBe(2); // tentou 2× (1 retry)
  });

  test("SR-08b card sem chaves obrigatórias 2× → error:gemini_bad_json", async () => {
    if (!mod) return;
    const incompleto = JSON.stringify({ ideia_central: "só isso" });
    const g = fakeGemini(incompleto, incompleto);
    const res = await mod.researchWeb("qualquer", { runGemini: g.run });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/^gemini_bad_json/);
  });

  test("retry: 1ª saída ruim, 2ª boa → ok", async () => {
    if (!mod) return;
    const g = fakeGemini("lixo", JSON.stringify(CARD_OK));
    const res = await mod.researchWeb("mcp", { runGemini: g.run });
    expect(res.ok).toBe(true);
    expect(g.calls()).toBe(2);
  });

  test("sources vazio quando o JSON não traz fontes", async () => {
    if (!mod) return;
    const semFontes = { ...CARD_OK, fontes: undefined };
    const g = fakeGemini(JSON.stringify(semFontes));
    const res = await mod.researchWeb("mcp", { runGemini: g.run });
    expect(res.ok).toBe(true);
    expect(res.sources).toEqual([]);
  });
});

// --- guarda de cota: depende de mecanismo não-especificado (adiado) ---
test.todo("SR-11 guarda de cota: contador de uso por mês (Gemini free tier) — adiado");
