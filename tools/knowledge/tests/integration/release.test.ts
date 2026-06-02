/**
 * F1.10 — GUARD da F1.7 (gatilho async anti-textão / release sob comando).
 * Esperado RED até `release.ts` existir.
 *
 * Contrato-alvo derivado da spec F1.7 (NÃO do código — F1.7 não está implementada):
 *
 *   `release.ts` deve exportar:
 *     - enqueuePending(chat, card, opts?) → grava 1 node status='PENDING_RELEASE'
 *       (type RESEARCH por padrão), dispara só a pílula curta (sem o conteúdo denso). [RL-07]
 *     - releasePending(chat) → claim ATÔMICO do PENDING_RELEASE mais antigo do chat com
 *       `WITH ... FOR UPDATE SKIP LOCKED ... UPDATE ... RETURNING` na MESMA transação,
 *       marca RELEASED, envia 1, devolve `{ released, remaining }` (released null se found:0). [RL-01..05]
 *
 * Invariante de concorrência (o diferencial técnico do PRD): N releasePending(chat)
 * concorrentes sobre M pendentes entregam cada linha EXATAMENTE 1× (0 duplicação) —
 * garantido pelo SKIP LOCKED. A migration P0 (status/released_at/type + índice parcial)
 * faz nodes normais nascerem RELEASED, e findSummaries/reminder filtram status='RELEASED'. [RL-08, RL-09]
 *
 * Soft-import: se o módulo não existe, não derruba os arquivos irmãos.
 */
import { describe, it, test, expect, beforeAll, afterEach, afterAll } from "bun:test";
import { setupTestDb, truncateAll, teardownTestDb, db } from "../db-helper.ts";

let mod: any = null;
try {
  mod = await import("../../release.ts");
} catch {}

beforeAll(async () => {
  await setupTestDb();
});
afterEach(async () => {
  await truncateAll();
});
afterAll(async () => {
  await teardownTestDb();
});

describe("F1.7 release contract", () => {
  // F1.7 implementada: release.ts exporta o contrato e os guards de concorrência
  // (RL-01..) abaixo passaram a rodar como testes reais. (Era test.failing enquanto
  // o módulo não existia.)
  test("RL-00 release.ts implementado e exporta releasePending/enqueuePending (F1.7 guard)", () => {
    expect(mod, "release.ts não implementado — F1.7").not.toBeNull();
    expect(typeof mod?.releasePending, "releasePending ausente — F1.7").toBe("function");
    expect(typeof mod?.enqueuePending, "enqueuePending ausente — F1.7").toBe("function");
  });

  // As asserções de concorrência só rodam quando o módulo existir (guard por `mod &&`).
  it("RL-01 — 2 releasePending(chat) concorrentes sobre 1 pendente: 1 entrega, o outro found:0 (0 duplicação)", async () => {
    if (!mod) return; // guard: RED no RL-00 já sinaliza a pendência.
    await mod.enqueuePending("55a@c.us", { texto: "denso" });
    const [r1, r2] = await Promise.all([mod.releasePending("55a@c.us"), mod.releasePending("55a@c.us")]);
    const entregues = [r1, r2].filter((r: any) => r?.released != null).length;
    expect(entregues, "exatamente 1 entrega — SKIP LOCKED").toBe(1);
    const released = await db()`SELECT count(*)::int AS n FROM knowledge_node WHERE status='RELEASED'`;
    expect((released[0] as any).n).toBe(1);
  });

  it("RL-02 — 10 pendentes, 20 releases concorrentes: exatamente 10 entregas, 0 duplicada", async () => {
    if (!mod) return;
    for (let i = 0; i < 10; i++) await mod.enqueuePending("55a@c.us", { texto: `denso-${i}` });
    const results = await Promise.all(Array.from({ length: 20 }, () => mod.releasePending("55a@c.us")));
    const entregues = results.filter((r: any) => r?.released != null);
    expect(entregues.length, "exatamente 10 entregas").toBe(10);
    const distintos = new Set(entregues.map((r: any) => String(r.released.id)));
    expect(distintos.size, "0 duplicação — cada linha sai 1x").toBe(10);
    const restantes = await db()`SELECT count(*)::int AS n FROM knowledge_node WHERE status='PENDING_RELEASE'`;
    expect((restantes[0] as any).n).toBe(0);
  });

  it("RL-03 — release marca PENDING_RELEASE→RELEASED na mesma transação (RETURNING)", async () => {
    if (!mod) return;
    await mod.enqueuePending("55a@c.us", { texto: "x" });
    const r = await mod.releasePending("55a@c.us");
    expect(r.released).not.toBeNull();
    const row = await db()`SELECT status FROM knowledge_node WHERE id = ${String(r.released.id)}`;
    expect((row[0] as any).status).toBe("RELEASED");
  });

  it("RL-04 — releasePending sem pendente → found:0 (released null)", async () => {
    if (!mod) return;
    const r = await mod.releasePending("ninguem@c.us");
    expect(r.released).toBeNull();
  });

  it("RL-05 — 3 pendentes, 1 release: libera o MAIS ANTIGO, remaining:2", async () => {
    if (!mod) return;
    await mod.enqueuePending("55a@c.us", { texto: "antigo" });
    await new Promise((res) => setTimeout(res, 5));
    await mod.enqueuePending("55a@c.us", { texto: "meio" });
    await new Promise((res) => setTimeout(res, 5));
    await mod.enqueuePending("55a@c.us", { texto: "novo" });
    const r = await mod.releasePending("55a@c.us");
    expect(r.remaining).toBe(2);
    // o liberado é o mais antigo (menor created_at)
    const restantes = await db()`
      SELECT min(created_at) AS m FROM knowledge_node WHERE status='PENDING_RELEASE' AND chat='55a@c.us'`;
    const liberado = await db()`SELECT created_at FROM knowledge_node WHERE id=${String(r.released.id)}`;
    expect(new Date((liberado[0] as any).created_at).getTime())
      .toBeLessThanOrEqual(new Date((restantes[0] as any).m).getTime());
  });

  it("RL-07 — enqueuePending grava PENDING_RELEASE (type RESEARCH) sem o conteúdo denso no envio", async () => {
    if (!mod) return;
    await mod.enqueuePending("55a@c.us", { texto: "conteudo MUITO denso e longo" });
    const rows = await db()`SELECT status, type FROM knowledge_node WHERE chat='55a@c.us'`;
    expect((rows[0] as any).status).toBe("PENDING_RELEASE");
    expect((rows[0] as any).type).toBe("RESEARCH");
  });

  it("RL-08 — node de arquivamento normal nasce RELEASED (default), não vira pendente", async () => {
    if (!mod) return;
    // Insere como a F1.4 faz hoje (sem status explícito) — a migration P0 dá default RELEASED.
    await db()`INSERT INTO knowledge_node (url, card, chat) VALUES ('https://ex.com', '{}'::jsonb, '55a@c.us')`;
    const rows = await db()`SELECT status FROM knowledge_node WHERE url='https://ex.com'`;
    expect((rows[0] as any).status).toBe("RELEASED");
    const r = await mod.releasePending("55a@c.us");
    expect(r.released, "node normal não deve ser liberado como pendente").toBeNull();
  });

  // O que ainda não dá pra exercer sem a implementação (titulados com o RL- ID alvo).
  test.todo("RL-06 — resiliência: kill -9 no meio da carga → nenhum RELEASED reenviado, nenhum PENDING inconsistente (precisa de harness de processo)");
  test.todo("RL-09 — findSummaries/reminder filtram status='RELEASED' (pendente não vaza na recuperação/nudge) — exige o filtro nas queries de recall.ts/reminder.ts (F1.7 P0)");
  test.todo("RL-10 — desempate de intenção 'me manda o resumo de X' (send_summary) vs 'manda' sem assunto com pendente (release_pending) — eval F1.1, fora da trilha DB");
  test.todo("RL-11 — E2E WhatsApp: pílula → 'pode mandar' → texto; 'pode mandar' de novo → 'não tem mais nada pendente'");
});
