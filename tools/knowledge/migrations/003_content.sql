-- Conteúdo completo do artigo. Até aqui o worker capturava o texto inteiro
-- (extract.ts → captured.text) mas só persistia título/tópico/card/summary —
-- então "me manda uma parte do artigo" não tinha de onde sair. Esta coluna
-- guarda o texto extraído por inteiro (Readability), pra recuperação sob demanda.
-- Re-rodável (ADD COLUMN IF NOT EXISTS). Nodes antigos ficam com content NULL
-- (não dá pra recuperar o que não foi salvo); novos passam a ter o texto cheio.

ALTER TABLE knowledge_node ADD COLUMN IF NOT EXISTS content text;
