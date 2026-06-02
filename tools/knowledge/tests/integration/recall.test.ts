/**
 * F1.10 — integração de `recall.ts` (F1.5 leitura) contra o DB descartável.
 *
 * Contrato derivado das specs (recuperação por assunto + Q&A sobre artigo salvo),
 * NÃO do código atual. Guarda os invariantes:
 *  - `findSummaries(assunto)`: ILIKE em topico OU title, ordenado por created_at DESC,
 *    parseia o `card` (jsonb→string) via CardSchema.
 *  - `findArticleForQA`: distingue ok (tem content) / no_content (casou, content NULL) /
 *    not_found; assunto vazio → mais recente COM content.
 *  - `markRecalled(id)`: seta last_recalled_at (sai da fila do reminder).
 *
 * setupTestDb aponta LINKMIND_PG_DB → linkmind_test ANTES de importar recall em runtime.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "bun:test";
import { setupTestDb, truncateAll, teardownTestDb, insertNode, db } from "../db-helper.ts";
import { findSummaries, findArticleForQA, markRecalled } from "../../recall.ts";

beforeAll(async () => {
  await setupTestDb();
});
afterEach(async () => {
  await truncateAll();
});
afterAll(async () => {
  await teardownTestDb();
});

describe("findSummaries — busca por assunto", () => {
  it("casa por ILIKE no topico (case-insensitive, parcial)", async () => {
    // Case-insensitivity provada com termo ASCII (case-folding de acento depende
    // do locale do DB; o contrato da spec é o ILIKE parcial sobre topico).
    await insertNode({ topico: "memoria de trabalho", title: "Como funciona a memoria" });
    const res = await findSummaries("MEMORIA");
    expect(res.length).toBe(1);
    expect(res[0]!.topico).toBe("memoria de trabalho");
  });

  it("casa por ILIKE no title quando o topico não bate", async () => {
    await insertNode({ topico: "outro assunto", title: "Introdução a Grafos" });
    const res = await findSummaries("grafos");
    expect(res.length).toBe(1);
    expect(res[0]!.title).toBe("Introdução a Grafos");
  });

  it("ordena por created_at DESC (mais recente primeiro)", async () => {
    await insertNode({ topico: "redis cache", title: "antigo", created_days_ago: 5 });
    await insertNode({ topico: "redis cache", title: "recente", created_days_ago: 0 });
    const res = await findSummaries("redis");
    expect(res.map((r) => r.title)).toEqual(["recente", "antigo"]);
  });

  it("parseia o card (jsonb→string) via CardSchema", async () => {
    await insertNode({
      topico: "feynman",
      card: { ideia_central: "ic", pilares: ["p1", "p2"], aplicacao: "ap", topico: "feynman" },
    });
    const res = await findSummaries("feynman");
    expect(res[0]!.card).toEqual({
      ideia_central: "ic",
      pilares: ["p1", "p2"],
      aplicacao: "ap",
      topico: "feynman",
    });
  });

  it("respeita o limit", async () => {
    for (let i = 0; i < 7; i++) await insertNode({ topico: "limite teste", created_days_ago: i });
    const res = await findSummaries("limite", 3);
    expect(res.length).toBe(3);
  });

  it("assunto vazio → []", async () => {
    await insertNode({ topico: "qualquer" });
    expect(await findSummaries("")).toEqual([]);
    expect(await findSummaries("   ")).toEqual([]);
  });

  it("nada casa → []", async () => {
    await insertNode({ topico: "java", title: "JVM" });
    expect(await findSummaries("kubernetes")).toEqual([]);
  });
});

describe("findArticleForQA — busca de artigo p/ Q&A", () => {
  it("ok: casou e tem content", async () => {
    await insertNode({ topico: "transformers", title: "Atenção", content: "texto puro do artigo" });
    const res = await findArticleForQA("transformers");
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.article.content).toBe("texto puro do artigo");
      expect(res.article.topico).toBe("transformers");
    }
  });

  it("no_content: casou mas content é NULL (node pré-feature de conteúdo)", async () => {
    await insertNode({ topico: "node antigo", title: "Sem texto", content: null });
    const res = await findArticleForQA("node antigo");
    expect(res.status).toBe("no_content");
    if (res.status === "no_content") expect(res.title).toBe("Sem texto");
  });

  it("not_found: nada casa", async () => {
    await insertNode({ topico: "existente", content: "x" });
    const res = await findArticleForQA("inexistente");
    expect(res.status).toBe("not_found");
  });

  it("com content tem prioridade sobre node sem content no mesmo assunto", async () => {
    // mais recente NÃO tem content; o com content é mais antigo → ainda assim vence (ORDER BY content NOT NULL DESC)
    await insertNode({ topico: "k8s", title: "com texto", content: "conteudo", created_days_ago: 3 });
    await insertNode({ topico: "k8s", title: "sem texto", content: null, created_days_ago: 0 });
    const res = await findArticleForQA("k8s");
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.article.title).toBe("com texto");
  });

  it("assunto vazio → mais recente COM content", async () => {
    await insertNode({ topico: "antigo", content: "antigo txt", created_days_ago: 5 });
    await insertNode({ topico: "recente", content: "recente txt", created_days_ago: 0 });
    await insertNode({ topico: "recentissimo sem content", content: null, created_days_ago: -1 as any });
    const res = await findArticleForQA("");
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.article.content).toBe("recente txt");
  });

  it("assunto vazio sem nenhum content salvo → not_found", async () => {
    await insertNode({ topico: "sem content", content: null });
    expect((await findArticleForQA("")).status).toBe("not_found");
  });
});

describe("markRecalled — marca como lido", () => {
  it("seta last_recalled_at (sai da fila do reminder)", async () => {
    const id = await insertNode({ topico: "ler depois", chat: "55119@c.us", created_days_ago: 10 });
    const before = await db()`SELECT last_recalled_at FROM knowledge_node WHERE id = ${id}`;
    expect((before[0] as any).last_recalled_at).toBeNull();

    await markRecalled(id);

    const after = await db()`SELECT last_recalled_at FROM knowledge_node WHERE id = ${id}`;
    expect((after[0] as any).last_recalled_at).not.toBeNull();
  });
});
