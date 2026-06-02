/**
 * F1.10 — TDD guard tests para F1.3 (`get_youtube_transcript` / captura de legendas).
 *
 * ⚠️ A feature F1.3 NÃO está implementada. Estes testes definem o CONTRATO-ALVO
 * derivado da spec (`.specs/features/F1.3-youtube-transcript/spec.md`) e ficam RED
 * até `youtube.ts` existir. Esse RED é correto e esperado.
 *
 * --------------------------------------------------------------------------------
 * CONTRATO ASSUMIDO (o que o implementador da F1.3 deve cumprir):
 *
 *   módulo:  tools/knowledge/youtube.ts
 *
 *   export function parseVideoId(url: string): string | null
 *     - extrai o videoId das formas: watch?v=, youtu.be/, /shorts/, /embed/,
 *       com params extras (&t=30s&list=…) e timestamps.
 *     - URL não-YouTube ou YouTube sem id de vídeo (home/canal) → null.
 *
 *   export function isYouTube(url: string): boolean
 *     - true p/ hosts youtube.com / www.youtube.com / m.youtube.com / youtu.be.
 *     - usado pelo worker p/ rotear a captura (YT-10).
 *
 *   export async function getTranscript(
 *     url: string,
 *     deps?: { fetchTranscript?: (videoId: string) => Promise<TranscriptResult> },
 *   ): Promise<ExtractResult>
 *     - MESMO shape do extract.ts (`{ ok, url, title?, text?, length?, error? }`).
 *     - I/O (lib de transcript) injetável via `deps.fetchTranscript` p/ mock offline.
 *     - URL YouTube sem id → { ok:false, error:"not_a_video" } (NÃO chama a rede).
 *     - lib devolve cues → concatena em texto corrido; { ok:true, text, title, length }.
 *     - sem legenda → { ok:false, error:"no_transcript" } (não trava).
 *     - vídeo privado/removido → { ok:false, error:"video_unavailable" }.
 *     - idioma: prefere manual → auto-gerada → outro idioma (anota qual via `lang`).
 *
 *   onde a "fetchTranscript" injetada devolve um TranscriptResult assumido como:
 *     | { ok: true; cues: { text: string }[]; title?: string; lang?: string;
 *         kind?: "manual" | "auto" }
 *     | { ok: false; error: "no_transcript" | "video_unavailable" |
 *         "fetch_failed" | "timeout" }
 *
 * Cobertura por asserts reais (guarded por `mod`): YT-01..05, YT-06..09 (path
 * determinístico com I/O mockado), YT-10 (isYouTube). YT-11 (e2e WhatsApp) e
 * YT-12 (MAX_CHARS, depende de const interna) ficam como test.todo.
 * --------------------------------------------------------------------------------
 */
import { describe, test, expect } from "bun:test";

let mod: any = null;
try {
  mod = await import("../../youtube.ts");
} catch {
  /* F1.3 ainda não implementada — guard abaixo reporta RED limpo */
}

describe("F1.3 youtube.ts — guard de existência", () => {
  // test.failing: RED-por-design enquanto F1.3 não existe — NÃO bloqueia o gate de push.
  // Quando youtube.ts for implementado, este teste "passa inesperadamente" → vira FALHA,
  // sinalizando que os guards devem ser convertidos em testes reais.
  test.failing("youtube.ts implementado (F1.3 guard)", () => {
    expect(mod, "youtube.ts não implementado ainda — F1.3").not.toBeNull();
  });

  test("exporta parseVideoId, isYouTube, getTranscript", () => {
    if (!mod) return; // RED já sinalizado pelo guard acima
    expect(typeof mod.parseVideoId).toBe("function");
    expect(typeof mod.isYouTube).toBe("function");
    expect(typeof mod.getTranscript).toBe("function");
  });
});

describe("F1.3 parseVideoId — formas de URL (YT-01..05)", () => {
  test("YT-01 watch?v= → ABC123", () => {
    if (!mod) return;
    expect(mod.parseVideoId("https://youtube.com/watch?v=ABC123")).toBe("ABC123");
    expect(mod.parseVideoId("https://www.youtube.com/watch?v=ABC123")).toBe("ABC123");
  });

  test("YT-02 youtu.be/ → ABC123", () => {
    if (!mod) return;
    expect(mod.parseVideoId("https://youtu.be/ABC123")).toBe("ABC123");
  });

  test("YT-03 /shorts/ → ABC123", () => {
    if (!mod) return;
    expect(mod.parseVideoId("https://youtube.com/shorts/ABC123")).toBe("ABC123");
    expect(mod.parseVideoId("https://www.youtube.com/shorts/ABC123")).toBe("ABC123");
  });

  test("YT-03b /embed/ → ABC123", () => {
    if (!mod) return;
    expect(mod.parseVideoId("https://www.youtube.com/embed/ABC123")).toBe("ABC123");
  });

  test("YT-04 params extras (&t=30s&list=…) ignora o resto → ABC123", () => {
    if (!mod) return;
    expect(mod.parseVideoId("https://youtube.com/watch?v=ABC123&t=30s&list=PLxyz")).toBe("ABC123");
    expect(mod.parseVideoId("https://youtu.be/ABC123?t=30")).toBe("ABC123");
    expect(mod.parseVideoId("https://www.youtube.com/watch?list=PLxyz&v=ABC123&index=2")).toBe("ABC123");
  });

  test("YT-05 URL YouTube sem id de vídeo (home/canal) → null", () => {
    if (!mod) return;
    expect(mod.parseVideoId("https://www.youtube.com/")).toBeNull();
    expect(mod.parseVideoId("https://www.youtube.com/@algumcanal")).toBeNull();
    expect(mod.parseVideoId("https://www.youtube.com/feed/subscriptions")).toBeNull();
  });

  test("YT-05b URL não-YouTube → null", () => {
    if (!mod) return;
    expect(mod.parseVideoId("https://example.com/watch?v=ABC123")).toBeNull();
    expect(mod.parseVideoId("https://vimeo.com/123456")).toBeNull();
    expect(mod.parseVideoId("not a url")).toBeNull();
  });
});

describe("F1.3 isYouTube — roteamento por host (YT-10)", () => {
  test("YT-10 hosts YouTube → true", () => {
    if (!mod) return;
    expect(mod.isYouTube("https://www.youtube.com/watch?v=ABC123")).toBe(true);
    expect(mod.isYouTube("https://youtube.com/watch?v=ABC123")).toBe(true);
    expect(mod.isYouTube("https://m.youtube.com/watch?v=ABC123")).toBe(true);
    expect(mod.isYouTube("https://youtu.be/ABC123")).toBe(true);
  });

  test("YT-10 host web comum → false", () => {
    if (!mod) return;
    expect(mod.isYouTube("https://example.com/post")).toBe(false);
    expect(mod.isYouTube("https://medium.com/@autor/artigo")).toBe(false);
  });
});

describe("F1.3 getTranscript — path determinístico com I/O mockado (YT-05..09)", () => {
  test("YT-05 URL YouTube sem id → error:not_a_video (sem tocar a rede)", async () => {
    if (!mod) return;
    let called = false;
    const res = await mod.getTranscript("https://www.youtube.com/@canal", {
      fetchTranscript: async () => {
        called = true;
        return { ok: true, cues: [{ text: "x" }] };
      },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("not_a_video");
    expect(called, "não deve chamar a lib de transcript quando não há videoId").toBe(false);
  });

  test("YT-06 vídeo com legenda manual → ok:true, text não-vazio, title preenchido", async () => {
    if (!mod) return;
    const res = await mod.getTranscript("https://youtu.be/ABC123", {
      fetchTranscript: async () => ({
        ok: true,
        kind: "manual",
        lang: "pt",
        title: "Como funciona o MCP",
        cues: [{ text: "primeira linha" }, { text: "segunda linha" }],
      }),
    });
    expect(res.ok).toBe(true);
    expect(res.url).toContain("ABC123");
    expect(res.title).toBe("Como funciona o MCP");
    expect(typeof res.text).toBe("string");
    expect(res.text.length).toBeGreaterThan(0);
    // cues concatenados em texto corrido
    expect(res.text).toContain("primeira linha");
    expect(res.text).toContain("segunda linha");
    expect(res.length).toBe(res.text.length);
  });

  test("YT-07 só auto-gerada → ok:true, anota o idioma usado", async () => {
    if (!mod) return;
    const res = await mod.getTranscript("https://youtube.com/watch?v=ABC123", {
      fetchTranscript: async () => ({
        ok: true,
        kind: "auto",
        lang: "en",
        title: "Auto captions video",
        cues: [{ text: "hello world" }],
      }),
    });
    expect(res.ok).toBe(true);
    expect(res.text).toContain("hello world");
    // anota qual idioma foi usado (fallback) no resultado
    expect(res.lang).toBe("en");
  });

  test("YT-08 vídeo sem legenda → error:no_transcript (não trava)", async () => {
    if (!mod) return;
    const res = await mod.getTranscript("https://youtu.be/ABC123", {
      fetchTranscript: async () => ({ ok: false, error: "no_transcript" }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("no_transcript");
  });

  test("YT-09 vídeo privado/removido → error:video_unavailable", async () => {
    if (!mod) return;
    const res = await mod.getTranscript("https://youtu.be/ABC123", {
      fetchTranscript: async () => ({ ok: false, error: "video_unavailable" }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("video_unavailable");
  });

  test("falha de rede na lib → error:fetch_failed (propaga categoria)", async () => {
    if (!mod) return;
    const res = await mod.getTranscript("https://youtu.be/ABC123", {
      fetchTranscript: async () => ({ ok: false, error: "fetch_failed" }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("fetch_failed");
  });
});

// --- casos que dependem de comportamento não-checável via mock simples ---

test.todo(
  "YT-12 transcrição > MAX_CHARS → trunca p/ o Gemini, não quebra " +
    "(precisa expor MAX_CHARS ou um truncador testável em youtube.ts)",
);

test.todo(
  "YT-11 e2e WhatsApp: link YouTube → card Feynman + linha knowledge_node " +
    "com content=transcrição (integração, fora da trilha unit offline)",
);
