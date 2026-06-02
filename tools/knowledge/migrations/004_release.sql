-- F1.7 — Gatilho async anti-textão (release sob comando).
-- Adiciona ao knowledge_node o ciclo de retenção/liberação:
--   status      = PENDING_RELEASE | RELEASED. Conteúdo denso (pesquisa F1.6) nasce
--                 PENDING_RELEASE e só vira RELEASED quando o usuário manda o gatilho.
--   released_at = quando foi liberado (auditoria; at-most-once pós-commit).
--   type        = LINK | YOUTUBE | RESEARCH — origem do node.
-- Re-rodável (ADD COLUMN IF NOT EXISTS). Default status='RELEASED' → nodes de
-- arquivamento normal (F1.4) e os já existentes NÃO viram pendentes (RL-08).

ALTER TABLE knowledge_node ADD COLUMN IF NOT EXISTS status      text NOT NULL DEFAULT 'RELEASED';
ALTER TABLE knowledge_node ADD COLUMN IF NOT EXISTS released_at timestamptz;
ALTER TABLE knowledge_node ADD COLUMN IF NOT EXISTS type        text NOT NULL DEFAULT 'LINK';

-- Índice parcial: a varredura de release filtra só pendentes de um chat por data.
CREATE INDEX IF NOT EXISTS knowledge_node_pending_idx
  ON knowledge_node (chat, created_at)
  WHERE status = 'PENDING_RELEASE';
