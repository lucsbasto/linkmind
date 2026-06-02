/**
 * F1.10 — testes unitários dos formatadores puros de `notify.ts` (F1.4).
 *
 * Contrato derivado da spec F1.4 (notify):
 *  - `formatCard`: card COMPLETO (ideia central, pilares como bullets, aplicação, tópico, url),
 *    com título caindo para `card.topico` quando ausente.
 *  - `formatConfirmation`: mensagem CURTA (anti-poluição), NÃO o card cheio, com a dica de "salvo".
 *
 * `sendWhatsApp` (spawn `omni`) NÃO é testado aqui — só os formatadores puros.
 */
import { describe, it, expect } from "bun:test";
import { formatCard, formatConfirmation } from "../../notify.ts";
import type { FeynmanCard } from "../../summarize.ts";

const CARD: FeynmanCard = {
  ideia_central: "A memória de trabalho tem capacidade limitada e curta duração.",
  pilares: [
    "Subsistemas verbal e visuoespacial coordenados por um executivo central",
    "Capacidade de ~4 a 7 itens, ampliada por agrupamento (chunking)",
    "Reduzir distrações e externalizar passos libera recursos mentais",
  ],
  aplicacao: "Divida tarefas complexas em passos menores e anote etapas.",
  topico: "memória de trabalho",
};

describe("formatCard — card completo", () => {
  const out = formatCard(CARD, "Como funciona a memória de trabalho", "https://blog.exemplo.com/memoria");

  it("contém o título", () => {
    expect(out).toContain("Como funciona a memória de trabalho");
  });

  it("contém a ideia central", () => {
    expect(out).toContain(CARD.ideia_central);
  });

  it("contém cada pilar como bullet", () => {
    for (const p of CARD.pilares) {
      expect(out).toContain(`• ${p}`);
    }
  });

  it("contém a aplicação", () => {
    expect(out).toContain(CARD.aplicacao);
  });

  it("contém o tópico", () => {
    expect(out).toContain(CARD.topico);
  });

  it("contém a url", () => {
    expect(out).toContain("https://blog.exemplo.com/memoria");
  });

  it("título undefined → cai para card.topico", () => {
    const fallback = formatCard(CARD, undefined, "https://blog.exemplo.com/memoria");
    expect(fallback).toContain(CARD.topico);
  });
});

describe("formatConfirmation — confirmação curta (anti-poluição)", () => {
  const out = formatConfirmation(CARD, "Como funciona a memória de trabalho");

  it("contém o título", () => {
    expect(out).toContain("Como funciona a memória de trabalho");
  });

  it("contém a dica de 'salvo'", () => {
    expect(out.toLowerCase()).toContain("salvo");
  });

  it("é curta — NÃO despeja o card completo (sem pilares/aplicação)", () => {
    expect(out).not.toContain(CARD.aplicacao);
    for (const p of CARD.pilares) {
      expect(out).not.toContain(p);
    }
    // claramente mais curta que o card cheio
    const full = formatCard(CARD, "Como funciona a memória de trabalho", "https://blog.exemplo.com/memoria");
    expect(out.length).toBeLessThan(full.length);
  });

  it("título undefined → cai para card.topico", () => {
    const fallback = formatConfirmation(CARD, undefined);
    expect(fallback).toContain(CARD.topico);
  });
});
