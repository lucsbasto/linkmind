/**
 * F1.10 — testes automatizados (TDD-guard) para F1.4 `summarize.ts`.
 *
 * Contrato derivado da spec F1.4 (card Feynman): { ideia_central, pilares[], aplicacao, topico }.
 * NUNCA chama o Gemini real (~140s): `_internals.runGemini` é mockado via spyOn.
 *
 * Cobre: extractJson (parser historicamente bugado), CardSchema (zod),
 * summarizeFeynman (válido / lixo+retry / input vazio), answerQuestion (válido / vazios).
 */
import { test, expect, describe, spyOn, afterEach } from "bun:test";
import { join } from "node:path";
import {
  extractJson,
  CardSchema,
  summarizeFeynman,
  answerQuestion,
  _internals,
} from "../../summarize.ts";

const FIXTURES = join(import.meta.dir, "..", "fixtures");
const fixture = (name: string) => Bun.file(join(FIXTURES, name)).text();

afterEach(() => {
  // Restaura qualquer spy aplicado em _internals.runGemini.
  spyOn(_internals, "runGemini").mockRestore();
});

// ---------------------------------------------------------------------------
// 1. extractJson — parser da saída do Gemini
// ---------------------------------------------------------------------------
describe("extractJson", () => {
  test("JSON bare {...} → parseia", () => {
    const out = extractJson('{"a":1,"b":"x"}');
    expect(out).toEqual({ a: 1, b: "x" });
  });

  test("cercado em ```json ... ``` → tira a cerca e parseia", async () => {
    const raw = await fixture("gemini-fenced.txt");
    const out = extractJson(raw) as Record<string, unknown>;
    expect(out.topico).toBe("Aprendizado ativo");
    expect(Array.isArray(out.pilares)).toBe(true);
  });

  test("preâmbulo/epílogo em volta do objeto → ainda extrai", async () => {
    const raw = await fixture("gemini-preamble.txt");
    const out = extractJson(raw) as Record<string, unknown>;
    expect(out.ideia_central).toBe("Entender supera memorizar.");
    expect(out.topico).toBe("Estudo eficaz");
  });

  test("fixture JSON válida → bate com o card", async () => {
    const raw = await fixture("gemini-valid.json");
    const out = extractJson(raw) as Record<string, unknown>;
    expect(out.topico).toBe("Técnica Feynman");
    expect((out.pilares as string[]).length).toBe(3);
  });

  test("lixo puro / sem chaves → LANÇA", async () => {
    const raw = await fixture("gemini-garbage.txt");
    expect(() => extractJson(raw)).toThrow();
  });

  test("string vazia → LANÇA", () => {
    expect(() => extractJson("")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. CardSchema — contrato zod do card Feynman
// ---------------------------------------------------------------------------
describe("CardSchema", () => {
  const valid = {
    ideia_central: "Entender supera memorizar.",
    pilares: ["Pensar do primeiro princípio", "Ensinar para fixar"],
    aplicacao: "Explique o tema para um colega.",
    topico: "Estudo eficaz",
  };

  test("card válido passa", () => {
    expect(CardSchema.safeParse(valid).success).toBe(true);
  });

  test("falta pilares → falha", () => {
    const { pilares, ...rest } = valid;
    expect(CardSchema.safeParse(rest).success).toBe(false);
  });

  test("pilares: [] (min 1) → falha", () => {
    expect(CardSchema.safeParse({ ...valid, pilares: [] }).success).toBe(false);
  });

  test("falta aplicacao → falha", () => {
    const { aplicacao, ...rest } = valid;
    expect(CardSchema.safeParse(rest).success).toBe(false);
  });

  test("falta topico → falha", () => {
    const { topico, ...rest } = valid;
    expect(CardSchema.safeParse(rest).success).toBe(false);
  });

  test('ideia_central: "" (min 1) → falha', () => {
    expect(CardSchema.safeParse({ ...valid, ideia_central: "" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. summarizeFeynman — runGemini SEMPRE mockado
// ---------------------------------------------------------------------------
describe("summarizeFeynman", () => {
  test("Gemini devolve JSON válido → { ok:true, card }", async () => {
    const raw = await fixture("gemini-valid.json");
    const spy = spyOn(_internals, "runGemini").mockResolvedValue(raw);

    const res = await summarizeFeynman("texto qualquer do artigo");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.card.topico).toBe("Técnica Feynman");
      expect(res.card.pilares.length).toBe(3);
    }
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("lixo na 1ª tentativa E no retry → { ok:false, gemini_bad_json } e roda 2x", async () => {
    const garbage = await fixture("gemini-garbage.txt");
    const spy = spyOn(_internals, "runGemini").mockResolvedValue(garbage);

    const res = await summarizeFeynman("texto qualquer do artigo");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toStartWith("gemini_bad_json:");
    // retry: precisa ter tentado o Gemini duas vezes.
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test("texto de entrada vazio → { ok:false } SEM chamar o Gemini", async () => {
    const spy = spyOn(_internals, "runGemini");

    const res = await summarizeFeynman("   ");

    expect(res.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. answerQuestion — runGemini SEMPRE mockado
// ---------------------------------------------------------------------------
describe("answerQuestion", () => {
  test("válido → { ok:true, answer }", async () => {
    const spy = spyOn(_internals, "runGemini").mockResolvedValue(
      "O artigo diz que entender supera memorizar.",
    );

    const res = await answerQuestion("Qual a ideia central?", "texto do artigo aqui");

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.answer).toContain("entender");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("artigo vazio → { ok:false } SEM chamar o Gemini", async () => {
    const spy = spyOn(_internals, "runGemini");

    const res = await answerQuestion("Qual a ideia?", "   ");

    expect(res.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  test("pergunta vazia → { ok:false } SEM chamar o Gemini", async () => {
    const spy = spyOn(_internals, "runGemini");

    const res = await answerQuestion("   ", "texto do artigo aqui");

    expect(res.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
