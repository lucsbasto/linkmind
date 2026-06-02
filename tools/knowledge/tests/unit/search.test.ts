/**
 * F1.10 — TDD guard tests para F1.6 (`search_web_knowledge` / wrapper Brave Search).
 *
 * ⚠️ A feature F1.6 NÃO está implementada. Estes testes definem o CONTRATO-ALVO
 * derivado da spec (`.specs/features/F1.6-search-web-knowledge/spec.md`) e ficam RED
 * até `search.ts` existir. Esse RED é correto e esperado.
 *
 * --------------------------------------------------------------------------------
 * CONTRATO ASSUMIDO (o que o implementador da F1.6 deve cumprir):
 *
 *   módulo:  tools/knowledge/search.ts
 *
 *   export async function braveSearch(
 *     query: string,
 *     deps?: { fetch?: typeof fetch; apiKey?: string },
 *   ): Promise<SearchResult>
 *     - `fetch` injetável (mock HTTP). `apiKey` default = process.env.BRAVE_API_KEY.
 *     - chama GET https://api.search.brave.com/res/v1/web/search?q=<query>
 *       com header X-Subscription-Token: <apiKey>.
 *     - shape de retorno (segue o padrão `{ ok:false, error }` do extract.ts/summarize.ts):
 *         | { ok: true;  results: { title: string; url: string; description: string }[] }
 *         | { ok: false; error: string }
 *     - mapa de erros (spec "Erros"):
 *         200 com web.results[] não-vazio  → { ok:true, results:[...] }     (SR-01)
 *         429                               → { ok:false, error:"brave_rate_limit" } (SR-02)
 *         5xx/4xx (≠429)                    → { ok:false, error:"brave_http:<status>" } (SR-03)
 *         web.results vazio                 → { ok:false, error:"brave_no_results" }  (SR-04)
 *         sem API key                       → { ok:false, error:"brave_no_key" }
 *
 * Cobertura por asserts reais (guarded por `mod`): SR-01, SR-02, SR-03, SR-04 +
 * missing-key. SR-08 (gemini lixo — pertence ao worker/summarize) e SR-11 (guarda
 * de cota — depende de contador interno não-especificado) ficam como test.todo.
 * --------------------------------------------------------------------------------
 */
import { describe, test, expect } from "bun:test";

let mod: any = null;
try {
  mod = await import("../../search.ts");
} catch {
  /* F1.6 ainda não implementada — guard abaixo reporta RED limpo */
}

/** Monta um fetch falso que devolve uma Response com o status/json dados. */
function fakeFetch(opts: { status?: number; body?: unknown }): typeof fetch {
  const status = opts.status ?? 200;
  const body = JSON.stringify(opts.body ?? {});
  return (async () =>
    new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

const BRAVE_OK_BODY = {
  web: {
    results: [
      {
        title: "O que é MCP",
        url: "https://example.com/mcp",
        description: "Model Context Protocol em uma frase.",
        extra: "ignorado",
      },
      {
        title: "MCP guia",
        url: "https://example.com/mcp-guia",
        description: "Guia prático.",
      },
    ],
  },
};

describe("F1.6 search.ts — guard de existência", () => {
  // test.failing: RED-por-design enquanto F1.6 não existe — NÃO bloqueia o gate de push.
  // Quando search.ts for implementado, este teste "passa inesperadamente" → vira FALHA,
  // sinalizando que os guards devem ser convertidos em testes reais.
  test.failing("search.ts implementado (F1.6 guard)", () => {
    expect(mod, "search.ts não implementado ainda — F1.6").not.toBeNull();
  });

  test("exporta braveSearch", () => {
    if (!mod) return;
    expect(typeof mod.braveSearch).toBe("function");
  });
});

describe("F1.6 braveSearch — mock HTTP (SR-01..04)", () => {
  test("SR-01 Brave 200 com web.results[] → lista {title,url,description} parseada", async () => {
    if (!mod) return;
    const res = await mod.braveSearch("o que é MCP", {
      apiKey: "FAKE",
      fetch: fakeFetch({ status: 200, body: BRAVE_OK_BODY }),
    });
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.results)).toBe(true);
    expect(res.results.length).toBe(2);
    const first = res.results[0];
    expect(first.title).toBe("O que é MCP");
    expect(first.url).toBe("https://example.com/mcp");
    expect(first.description).toBe("Model Context Protocol em uma frase.");
    // só os 3 campos do contrato — nada de campos crus da Brave vazando
    expect(Object.keys(first).sort()).toEqual(["description", "title", "url"]);
  });

  test("SR-02 Brave 429 → error:brave_rate_limit", async () => {
    if (!mod) return;
    const res = await mod.braveSearch("qualquer", {
      apiKey: "FAKE",
      fetch: fakeFetch({ status: 429 }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("brave_rate_limit");
  });

  test("SR-03 Brave 5xx → error:brave_http:<status>", async () => {
    if (!mod) return;
    const res = await mod.braveSearch("qualquer", {
      apiKey: "FAKE",
      fetch: fakeFetch({ status: 503 }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("brave_http:503");
  });

  test("SR-03b Brave 4xx (≠429) → error:brave_http:<status>", async () => {
    if (!mod) return;
    const res = await mod.braveSearch("qualquer", {
      apiKey: "FAKE",
      fetch: fakeFetch({ status: 401 }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("brave_http:401");
  });

  test("SR-04 web.results vazio → error:brave_no_results", async () => {
    if (!mod) return;
    const res = await mod.braveSearch("kjsdfkjasdf absurdo", {
      apiKey: "FAKE",
      fetch: fakeFetch({ status: 200, body: { web: { results: [] } } }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("brave_no_results");
  });

  test("SR-04b corpo 200 sem campo web → error:brave_no_results", async () => {
    if (!mod) return;
    const res = await mod.braveSearch("nada", {
      apiKey: "FAKE",
      fetch: fakeFetch({ status: 200, body: {} }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("brave_no_results");
  });

  test("API key ausente → error:brave_no_key (não chama a rede)", async () => {
    if (!mod) return;
    let called = false;
    const spyFetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const res = await mod.braveSearch("o que é MCP", { apiKey: "", fetch: spyFetch });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("brave_no_key");
    expect(called, "sem API key não deve chamar a Brave").toBe(false);
  });

  test("envia o header X-Subscription-Token com a apiKey", async () => {
    if (!mod) return;
    let seenToken: string | null = null;
    const spyFetch = (async (_url: any, init: any) => {
      const headers = new Headers(init?.headers);
      seenToken = headers.get("X-Subscription-Token");
      return new Response(JSON.stringify(BRAVE_OK_BODY), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    await mod.braveSearch("o que é MCP", { apiKey: "FAKE-TOKEN", fetch: spyFetch });
    expect(seenToken).toBe("FAKE-TOKEN");
  });
});

// --- casos que pertencem ao worker / dependem de estado não-especificado ---

test.todo(
  "SR-08 Gemini devolve lixo 2× → error:gemini_bad_json " +
    "(coberto por summarize.ts/search-worker, não pelo wrapper braveSearch)",
);

test.todo(
  "SR-11 guarda de cota: contador de uso incrementa por query " +
    "(depende do mecanismo de contagem definido na implementação da F1.6)",
);
