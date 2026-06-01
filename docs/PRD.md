# Documento de Requisitos de Produto (PRD)

## 1. Visão Geral do Produto

### 1.1 Nome do Projeto

**LinkMind** – O Seu Segundo Cérebro Conversacional e Proativo no WhatsApp.

### 1.2 O Problema (A Dor do Usuário)

As pessoas consomem e geram uma quantidade avassaladora de informações e ideias diariamente — desde artigos científicos sobre nutrição e análises históricas até tutoriais técnicos ou pensamentos espontâneos. Sem um ecossistema centralizado e fluido, o WhatsApp acaba virando um "cemitério de arquivos mortos". O conhecimento se perde porque links ficam soterrados no chat, impedindo a organização, a busca semântica, o cruzamento de ideias e a aplicação prática desse aprendizado na rotina real do usuário.

### 1.3 A Solução (Visão do Produto)

O **LinkMind** é um assistente de gestão de conhecimento pessoal ativo (PKM). Ele opera de forma agnóstica a domínios, permitindo que o usuário centralize qualquer tipo de conteúdo, dúvida ou pensamento enviando mensagens de texto e links pelo WhatsApp.

Conectado nativamente ao ecossistema **Omni** e **Genie** (Namastex Labs), o agente gerencia o ciclo completo do conhecimento de ponta a ponta:

- **Captura Reativa & Enriquecimento:** Limpa páginas da web e extrai legendas de vídeos, gerando resumos cognitivos estruturados no PostgreSQL (pgserve).
- **Curadoria Ativa (Pesquisa sob Demanda):** Varre a internet para responder a dúvidas textuais, gerando pílulas de conhecimento salvas em segundo plano para consumo sob demanda (evitando o envio de blocos massivos de texto).
- **Engajamento Ativo:** Notifica o usuário de maneira assíncrona para mitigar a curva do esquecimento com tolerância absoluta a falhas de infraestrutura.

---

## 2. Personas e Casos de Uso

### 2.1 Persona Principal: O Aprendiz Contínuo (Lifelong Learner)

**Comportamento:** Curioso por natureza. Estuda tópicos diversos (nutrição, finanças, tecnologia, história) e precisa de uma interface de entrada única, rápida e com fricção zero para descarregar ideias e organizar o dia a dia.

### 2.2 Casos de Uso do Ecossistema

#### Caso de Uso A: O Insight Textual e Cruzamento de Ideias (Efeito Zettelkasten)

O usuário envia uma mensagem espontânea:

> "Pensei aqui... Eu li aquele artigo de jejum e o outro sobre alta performance no trabalho. Acho que se eu quebrar o jejum só depois da minha reunião mais importante da manhã, meu foco vai ser bem maior".

**Output do Sistema:** O bot armazena o texto e responde com um card estruturado que resume a ideia e aponta conexões automáticas com artigos salvos anteriormente na base (efeito **Zettelkasten**).

#### Caso de Uso B: A Dúvida Espontânea (Pesquisa Dinâmica Sob Demanda)

O usuário envia:

> "Quero um resumo sobre os benefícios do farelo de uva".

O bot varre a web, consolida o resumo científico e notifica o usuário sem poluir o chat:

> "Já pesquisei e estruturei tudo na sua base. Quando quiser ler, é só me pedir por aqui!".

O conteúdo completo só é liberado quando o usuário acionar o gatilho (ex: *"pode mandar"*).

---

## 3. Escopo Funcional e Funcionalidades Core

### 3.1 Pipeline de Ingestão Multimídia (Entrada)

- **Scraper Universal Adaptável:** Limpa e extrai o texto central de qualquer portal de conteúdo, ignorando anúncios e menus HTML.
- **YouTube Video Indexer:** Consome legendas de vídeos informativos, transformando conteúdo audiovisual em dados textuais indexáveis.

### 3.2 Motor de Pesquisa Web (Ação)

- **Detecção Dinâmica de Intenção:** Identifica quando o usuário está trazendo um link para arquivamento ou uma dúvida para pesquisa.
- **Gatilho Async de UX (Anti-Textão):** Armazena resumos densos de pesquisas em segundo plano no Postgres, aguardando a permissão explícita do usuário para enviar o texto final.

### 3.3 Sumarização Cognitiva (Foco em Aprendizado)

Aplica modelos estruturados baseados na **Técnica de Feynman** e em aprendizado acelerado:

- **A Ideia Central:** O conceito complexo explicado em um parágrafo de forma ultra-simples.
- **Os Pilares (Core Takeaways):** Lista com os dados fundamentais e descobertas do texto.
- **Aplicação Prática:** Recomendações diretas de como o usuário aplica aquilo na sua realidade.

### 3.4 Sistema Ativo Anti-Esquecimento (Repetição Espaçada)

- **Revisão Espaçada Automatizada:** O sistema faz varreduras automáticas e envia pílulas proativas de conteúdos salvos dias atrás:

> "Faz 3 dias que você salvou o insight sobre a Dieta Cetogênica. O ponto principal que você mencionou foi X. Quer revisar a nota completa?".

---

## 4. Arquitetura Técnica e Integração (Ecossistema Namastex)

O produto adere estritamente à topologia de três camadas orientada a eventos da Namastex:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CAMADA 1: CANAL (OMNI)                          │
│  - Conexão nativa via Baileys (WhatsApp WebSockets)                    │
│  - Captura de Texto e Links                                            │
│  - Normalização de Payloads e publicação no NATS JetStream             │
│    (subject `message.received.whatsapp-baileys.<instance>`)            │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   CAMADA 2: ORQUESTRAÇÃO (GENIE)                       │
│  - Daemon consumidor de eventos NATS JetStream                         │
│  - Execução do agente via @anthropic-ai/claude-agent-sdk               │
│  - Isolamento entre execuções por git worktrees paralelos              │
│  - Raciocínio Multi-passo (Chain of Thought para decidir ações)        │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    CAMADA 3: CAPACIDADES (TOOLS)                       │
│  - Tools customizadas em TypeScript/Bun (mecânica de registro          │
│    a definir após spike de descoberta — ver F0.1)                      │
│  - Integração com APIs de busca web e extração de conteúdo             │
│  - Persistência Relacional e Transacional ACID no Postgres (pgserve,   │
│    pacote externo supervisionado por PM2 no host)                      │
└────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Inventário de Ferramentas (Tools / MCP)

| Ferramenta | Descrição |
|---|---|
| `fetch_web_content(url)` | Realiza a extração e limpeza do texto central de páginas web. |
| `get_youtube_transcript(video_id)` | Recupera transcrições de vídeos. |
| `search_web_knowledge(query)` | Realiza pesquisas e varreduras em tempo real na internet. |
| `save_knowledge_node(payload)` | Escrita estruturada do conhecimento no PostgreSQL (pgserve). |

---

## 5. Requisitos Não-Funcionais e Robustez (Critérios Sênior)

### 5.1 Resiliência de Estado Transacional (Anti-Cron)

O agendamento e o disparo dos alertas proativos (Read Later) e revisões espaçadas são **Stateful**, baseados no banco de dados Postgres (pgserve) fornecido de forma nativa pela infraestrutura do Genie.

O loop de polling utiliza a estratégia transacional `FOR UPDATE SKIP LOCKED`. Isso previne condições de corrida caso o sistema seja escalado e garante resiliência absoluta: se o servidor sofrer uma queda e ficar offline, nenhum agendamento de conhecimento é perdido ou duplicado; ao retornar, ele executa os registros em atraso retroativamente de forma segura.

### 5.2 Segurança de Escopo e Proteção de Prompt (Prompt Hardening)

O System Prompt do agente (executado via Claude Agent SDK dentro do Genie) é rigidamente blindado contra ataques de **Prompt Injection**. Se o usuário tentar forçar o robô a executar ações fora do domínio de gestão de conhecimento e rotina pessoal, o agente aplica uma contenção segura, recusando o desvio e reforçando o seu papel como um **Segundo Cérebro**.

### 5.3 Postura Cognitiva Agnóstica de Domínio

A inteligência do prompt impede que o modelo assuma vieses de nicho (como achar que o usuário é apenas um programador). O modelo responde com o mesmo rigor analítico, clareza didática e capacidade consultiva ao processar dados de engenharia de software de baixa latência, artigos de nutrição ou blocos de horários de treinos.

### 5.4 Reprodutibilidade de Ambiente

A stack do ecossistema Namastex (**Omni**, **Genie** e **pgserve**) opera na máquina anfitriã como pacotes globais supervisionados por **PM2**, instalados via os scripts oficiais (`install.sh` do Omni e `get.automagik.dev/genie`). Sobre essa base, todos os serviços próprios deste projeto (tool runner em TS/Bun e quaisquer auxiliares) são empacotados de forma declarativa via **Docker Compose**, e o setup ponta a ponta é exercitado por um script de verificação (`make verify` ou equivalente), simplificando o processo de validação end-to-end automatizada por parte da banca examinadora.
