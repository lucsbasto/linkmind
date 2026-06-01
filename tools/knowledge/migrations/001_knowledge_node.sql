-- F1.4 / P0 — tabela mínima de arquivamento de conhecimento.
-- Re-rodável (IF NOT EXISTS). Evolui pro schema completo (source/summary
-- separados, tipos LINK|YOUTUBE|RESEARCH, índices) em F1.5/F2.1.

CREATE TABLE IF NOT EXISTS knowledge_node (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url          text NOT NULL,
  title        text,
  topico       text,                -- p/ recuperação por assunto ("me envia o link de tal assunto")
  card         jsonb NOT NULL,      -- { ideia_central, pilares[], aplicacao }
  summary_text text,                -- card achatado p/ display/busca rápida
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Recuperação futura por tópico será por texto; índice trigram/full-text entra
-- quando a feature de leitura for specada. Por ora, um índice simples no created_at
-- ajuda listagens recentes.
CREATE INDEX IF NOT EXISTS knowledge_node_created_at_idx ON knowledge_node (created_at DESC);
