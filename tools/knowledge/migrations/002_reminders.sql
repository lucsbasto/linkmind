-- F1.6 — Lembretes proativos (revisão espaçada de artigos não lidos).
-- Re-rodável (ADD COLUMN IF NOT EXISTS). Adiciona ao knowledge_node:
--   chat            = chat de ORIGEM (pra onde mandar o lembrete; multi-usuário)
--   last_recalled_at = quando o card foi recuperado via send_summary (NULL = nunca lido)
--   reminder_count   = quantos lembretes já mandamos (teto de insistência)
--   last_reminder_at = quando mandamos o último lembrete (respeita o intervalo)

ALTER TABLE knowledge_node ADD COLUMN IF NOT EXISTS chat             text;
ALTER TABLE knowledge_node ADD COLUMN IF NOT EXISTS last_recalled_at timestamptz;
ALTER TABLE knowledge_node ADD COLUMN IF NOT EXISTS reminder_count   int NOT NULL DEFAULT 0;
ALTER TABLE knowledge_node ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz;

-- Acelera a varredura do reminder.ts (não-lidos, por data).
CREATE INDEX IF NOT EXISTS knowledge_node_unread_idx
  ON knowledge_node (chat, created_at)
  WHERE last_recalled_at IS NULL;
