/**
 * F1.10 — integração de `reminder.ts` (F1.6 revisão espaçada) contra o DB descartável.
 *
 * Contrato derivado da spec F1.6 (lembretes proativos), NÃO do código atual:
 *  - `buscarPendentes()`: DISTINCT ON (chat) → 1 node por chat (o MAIS ANTIGO elegível);
 *    só não-lidos (last_recalled_at IS NULL); só idade ≥ DIAS; só reminder_count < MAX;
 *    respeita o intervalo de last_reminder_at (≥ DIAS desde o último lembrete).
 *  - `formatNudge(p)`: título+link sem o card; cai p/ topico quando title é null.
 *
 * NÃO envia WhatsApp (sendWhatsApp não é exercido). Idades determinísticas via
 * created_days_ago no seed + overrides LINKMIND_REMINDER_DIAS / _MAX.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach } from "bun:test";
import { setupTestDb, truncateAll, teardownTestDb, insertNode } from "../db-helper.ts";
import { buscarPendentes, formatNudge } from "../../reminder.ts";

beforeAll(async () => {
  await setupTestDb();
});
beforeEach(() => {
  // Defaults determinísticos por teste; cada teste pode sobrescrever.
  process.env.LINKMIND_REMINDER_DIAS = "3";
  process.env.LINKMIND_REMINDER_MAX = "3";
});
afterEach(async () => {
  await truncateAll();
  delete process.env.LINKMIND_REMINDER_DIAS;
  delete process.env.LINKMIND_REMINDER_MAX;
});
afterAll(async () => {
  await teardownTestDb();
});

describe("buscarPendentes — varredura de não-lidos", () => {
  it("pega artigo parado há ≥ DIAS, não lido, abaixo do teto", async () => {
    await insertNode({ chat: "55a@c.us", topico: "parado", created_days_ago: 10 });
    const p = await buscarPendentes();
    expect(p.length).toBe(1);
    expect(p[0]!.chat).toBe("55a@c.us");
  });

  it("ignora artigo mais novo que DIAS", async () => {
    await insertNode({ chat: "55a@c.us", topico: "novo", created_days_ago: 1 });
    expect(await buscarPendentes()).toEqual([]);
  });

  it("ignora já lido (last_recalled_at NOT NULL)", async () => {
    await insertNode({ chat: "55a@c.us", topico: "lido", created_days_ago: 10, last_recalled_at: new Date() });
    expect(await buscarPendentes()).toEqual([]);
  });

  it("ignora node sem chat (chat NULL)", async () => {
    await insertNode({ chat: null, topico: "sem chat", created_days_ago: 10 });
    expect(await buscarPendentes()).toEqual([]);
  });

  it("ignora node no teto de lembretes (reminder_count >= MAX)", async () => {
    await insertNode({ chat: "55a@c.us", topico: "esgotado", created_days_ago: 10, reminder_count: 3 });
    expect(await buscarPendentes()).toEqual([]);
    // abaixo do teto volta
    await insertNode({ chat: "55b@c.us", topico: "ainda vale", created_days_ago: 10, reminder_count: 2 });
    const p = await buscarPendentes();
    expect(p.length).toBe(1);
    expect(p[0]!.chat).toBe("55b@c.us");
  });

  it("respeita o intervalo: ignora se último lembrete foi há < DIAS", async () => {
    const ontem = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    await insertNode({ chat: "55a@c.us", topico: "recém lembrado", created_days_ago: 10, last_reminder_at: ontem });
    expect(await buscarPendentes()).toEqual([]);
  });

  it("inclui se o último lembrete foi há ≥ DIAS", async () => {
    const haMuito = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await insertNode({ chat: "55a@c.us", topico: "pode de novo", created_days_ago: 10, last_reminder_at: haMuito });
    const p = await buscarPendentes();
    expect(p.length).toBe(1);
  });

  it("DISTINCT ON (chat): 1 node por chat, o MAIS ANTIGO elegível", async () => {
    await insertNode({ chat: "55a@c.us", topico: "antigo-a", created_days_ago: 20 });
    await insertNode({ chat: "55a@c.us", topico: "novo-a", created_days_ago: 5 });
    await insertNode({ chat: "55b@c.us", topico: "unico-b", created_days_ago: 8 });
    const p = await buscarPendentes();
    expect(p.length).toBe(2);
    const byChat = Object.fromEntries(p.map((x) => [x.chat, x.topico]));
    expect(byChat["55a@c.us"]).toBe("antigo-a"); // o mais antigo do chat a
    expect(byChat["55b@c.us"]).toBe("unico-b");
  });

  it("override LINKMIND_REMINDER_DIAS muda a elegibilidade", async () => {
    await insertNode({ chat: "55a@c.us", topico: "5 dias", created_days_ago: 5 });
    process.env.LINKMIND_REMINDER_DIAS = "7"; // agora 5 dias é cedo demais
    expect(await buscarPendentes()).toEqual([]);
    process.env.LINKMIND_REMINDER_DIAS = "3"; // volta a ser elegível
    expect((await buscarPendentes()).length).toBe(1);
  });

  it("override LINKMIND_REMINDER_MAX muda o teto", async () => {
    await insertNode({ chat: "55a@c.us", topico: "count 3", created_days_ago: 10, reminder_count: 3 });
    process.env.LINKMIND_REMINDER_MAX = "5"; // agora count 3 está abaixo do teto
    expect((await buscarPendentes()).length).toBe(1);
  });

  it("idade_dias reportada bate com a idade do seed", async () => {
    await insertNode({ chat: "55a@c.us", topico: "idade", created_days_ago: 12 });
    const p = await buscarPendentes();
    expect(p[0]!.idade_dias).toBe(12);
  });
});

describe("formatNudge — cutucão curto (anti-poluição)", () => {
  const base = { id: "1", chat: "55a@c.us", url: "https://ex.com/x", idade_dias: 7 };

  it("contém título, url e a dica de pedir o resumo; NÃO despeja o card", () => {
    const out = formatNudge({ ...base, title: "O Artigo", topico: "tema" });
    expect(out).toContain("O Artigo");
    expect(out).toContain("https://ex.com/x");
    expect(out).toContain("me manda o resumo de tema");
    expect(out).toContain("7 dias");
  });

  it("title null → cai para topico", () => {
    const out = formatNudge({ ...base, title: null, topico: "tema solto" });
    expect(out).toContain("tema solto");
  });
});
