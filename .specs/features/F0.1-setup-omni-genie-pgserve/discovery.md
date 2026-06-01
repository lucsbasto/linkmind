# F0.1 Discovery — Contratos Omni/Genie/pgserve

**Spike executado em:** 2026-06-01
**Commits inspecionados:** Omni `9169fba` / Genie `de48132`

> Os repos clonados ficam em `c:\Users\lucsb\Desktop\linkmind\.tmp-spike\omni` e `...\genie` para inspeção posterior.

---

## Resumo executivo

A integração Omni ↔ Genie **NÃO** usa JetStream para mensagens de chat. O fluxo é:

1. **WhatsApp → Omni:** Baileys publica `message.received.whatsapp-baileys.<inst>` em **JetStream** (stream `MESSAGE`) — consumido internamente pelo agent-dispatcher do Omni.
2. **Omni → Genie:** O agent-dispatcher chama `NatsGenieProvider.trigger()`, que publica em **NATS core (não-JetStream)** no subject `omni.message.<instanceId>.<chatId>`.
3. **Genie processa:** `omni-bridge` faz `nc.subscribe('omni.message.>', { queue: 'genie-bridge' })` (core NATS, queue group), aciona executor SDK.
4. **Genie → Omni (resposta):** Agente chama tool `done` (MCP server `genie-omni-tools`) OU hook `SendMessage(to: 'omni')`, publicando em `omni.reply.<instanceId>.<chatId>`.
5. **Omni → WhatsApp:** `NatsGenieProvider.startReplySubscription()` recebe e chama callback `onReply` → `sendTextMessage(channel, instanceId, chatId, content)` → Baileys.

Existem **duas camadas distintas de NATS** no Omni: a "canônica" (JetStream, com schemas/streams/headers via wrapper `OmniEvent`) e a "ponte do Genie" (core NATS plain, payloads ad-hoc).

---

## Q1 — Envelope NATS JetStream

### Resposta sintética

Para o **fluxo canônico interno do Omni** (`message.received.<channelType>.<instanceId>`), o payload é um objeto `OmniEvent` JSON-encoded (sem headers NATS), publicado em JetStream stream `MESSAGE`. **Mas o Genie NÃO consome esse subject.** O subject que o Genie consome (`omni.message.<inst>.<chat>`) é publicado pelo `NatsGenieProvider` em NATS core (sem JetStream), com payload `NatsOutboundMessage` (não `IncomingMessageSchema`).

### Evidência

**Subject hierárquico canônico:** `{eventType}.{channelType}.{instanceId}` (fonte: `packages/core/src/events/nats/subjects.ts:31-33`)

```typescript
export function buildSubject(eventType: EventType, channelType: ChannelType, instanceId: string): string {
  return `${eventType}.${channelType}.${instanceId}`;
}
```

**Wrapper de evento (envelope real publicado em JetStream):** `packages/core/src/events/nats/client.ts:195-211`

```typescript
const event: OmniEvent = {
  id: eventId,
  type,
  payload,
  timestamp,
  metadata: {
    correlationId: metadata?.correlationId ?? eventId,
    instanceId: metadata?.instanceId,
    channelType: metadata?.channelType,
    personId: metadata?.personId,
    platformIdentityId: metadata?.platformIdentityId,
    traceId: metadata?.traceId ?? eventId,
    source: metadata?.source ?? this.config.serviceName,
    ingestMode: metadata?.ingestMode,
    timings: metadata?.timings,
  },
};
```

E é encodado e publicado **sem headers NATS** em `client.ts:228-229`:

```typescript
const data = this.sc.encode(JSON.stringify(event));
const ack = await js.publish(subject, data);
```

Portanto a metadata (instanceId, traceId, channelType…) vai **dentro do JSON do body**, não em headers NATS.

**Stream e retenção (`MESSAGE`):** `packages/core/src/events/nats/streams.ts:40-47`

```typescript
[STREAM_NAMES.MESSAGE]: {
  name: STREAM_NAMES.MESSAGE,
  subjects: ['message.>'],
  max_age: daysToNs(30),
  storage: StorageType.File,
  retention: RetentionPolicy.Limits,
  description: 'All message lifecycle events (received, sent, delivered, read, failed)',
},
```

**Consumer durável default:** `packages/core/src/events/nats/consumer.ts:40-66`

```typescript
const config: Partial<ConsumerConfig> = {
  filter_subject: pattern,
  ack_policy: AckPolicy.Explicit,
  ack_wait: ackWaitMs * 1_000_000,
  max_deliver: maxRetries + 1, // +1 because first delivery counts
  max_ack_pending: DEFAULT_CONSUMER_CONFIG.maxAckPending,
  deliver_policy: mapStartFrom(startFrom),
};
if (durable) {
  config.durable_name = durable;
} else {
  config.inactive_threshold = DEFAULT_CONSUMER_CONFIG.ephemeralInactiveThresholdMs * 1_000_000;
}
if (queue) {
  config.deliver_group = queue;
}
```

Defaults (`consumer.ts:17-26`): `maxRetries=3`, `ackWaitMs=30000`, `maxAckPending=1000`, `startFrom='new'` (mapeado para `DeliverPolicy.New`).

**Payload de inbound (`IncomingMessageSchema`) — só o `payload` dentro do envelope:** `packages/core/src/schemas/message.ts:86-101`

```typescript
export const IncomingMessageSchema = z.object({
  externalId: z.string(),
  chatId: z.string(),
  from: z.string(),
  content: z.object({
    type: ContentTypeSchema,
    text: z.string().optional(),
    mediaUrl: z.string().url().optional(),
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    duration: z.number().int().optional(),
  }),
  replyToId: z.string().optional(),
  timestamp: z.number().int(),
  rawPayload: MetadataSchema.optional(),
});
```

Nota: em `packages/core/src/events/types.ts:201-217` há `MessageReceivedPayload` (TS interface) que é a forma "tipada" do payload no `EventPayloadMap`. As duas formas (Zod schema + TS interface) coexistem; o emissor (`BaseChannelPlugin.publishEventInternal`) usa o tipo `EventPayloadMap[K]`.

**NATS URL/auth default:** `packages/core/src/events/nats/client.ts:52-60`

```typescript
const DEFAULTS = {
  url: 'nats://localhost:4222',
  serviceName: 'omni',
  reconnect: {
    maxRetries: 10,
    delayMs: 1000,
    maxDelayMs: 30_000,
  },
} as const;
```

Auth (`client.ts:118-122`): se `config.credentials` for fornecido, seta `connectionOptions.user`/`.pass`; caso contrário sem auth.

**Emissão real pelo canal WhatsApp:** `packages/channel-sdk/src/base/BaseChannelPlugin.ts:374-380`

```typescript
protected async emitMessageReceived(params: EmitMessageReceivedParams): Promise<string> {
  const { instanceId, timings, isHistorySync, ...payload } = params;
  return this.publishEventInternal('message.received', payload, instanceId, {
    timings,
    ingestMode: isHistorySync ? 'history-sync' : 'realtime',
  });
}
```

### Consequência para nosso design

- **Subscribers externos canônicos** (se quisermos plugar fora do Omni) precisam: conectar em NATS, criar consumer durável no stream `MESSAGE` com `filter_subject: 'message.received.whatsapp-baileys.>'`, `ack_policy: Explicit`, `deliver_policy: New`. Mas para o nosso caso (LinkMind ouvindo WhatsApp), **não vamos consumir esse subject diretamente** — vamos viver atrás do `nats-genie` provider (Q2/Q3).
- **Não existe `traceId` em header NATS.** Se quisermos correlation/tracing, lemos do JSON body do envelope ou do payload `NatsOutboundMessage`.
- **Default `nats://localhost:4222`** sem auth — para produção/cloud teremos que setar credentials.

---

## Q2 — Subject de OUTBOUND (resposta do agente)

### Resposta sintética

O agente responde publicando em **NATS core (não-JetStream)** no subject `omni.reply.<instanceId>.<chatId>`. O payload é um objeto JSON ad-hoc (`NatsReplyMessage`), **não** `OutgoingMessageSchema`. Quem consome é `NatsGenieProvider.startReplySubscription()` no processo do Omni (`nc.subscribe('omni.reply.<inst>.>')`), que invoca o callback `onReply` registrado pelo agent-dispatcher, o qual chama `sendTextMessage(channel, instanceId, chatId, content)` para entregar no Baileys.

### Evidência

**Subject de reply:** `packages/core/src/providers/nats-genie-provider.ts:178-189`

```typescript
async startReplySubscription(): Promise<void> {
  if (!this.config.onReply) return;
  if (this.replySubscription) return;

  await this.ensureConnected();
  if (!this.nc) return;

  const topic = `omni.reply.${this.config.instanceId}.>`;
  const sub = this.nc.subscribe(topic);
```

Nota importante (`nats-genie-provider.ts:170-177`): o wildcard `>` é **obrigatório** porque chat IDs do WhatsApp contêm pontos (`5511...@s.whatsapp.net`) e o NATS tokeniza por ponto.

**Payload de reply (definido inline em `nats-genie-provider.ts:61-69`):**

```typescript
interface NatsReplyMessage {
  content: string;
  agent: string;
  chat_id: string;
  instance_id?: string;
  timestamp: string;
  auto_reply?: boolean;
}
```

**Como o agente publica do lado do Genie — tool `done` do MCP server:** `genie/src/services/executors/claude-sdk.ts:143-167`

```typescript
export function handleDoneTool(
  params: Record<string, unknown>,
  env: Record<string, string>,
  natsPublish: NatsPublishFn | null,
): string {
  const instanceId = env.OMNI_INSTANCE ?? '';
  const chatId = env.OMNI_CHAT ?? '';
  const agent = env.OMNI_AGENT ?? '';
  const action = resolveAction(params, env);

  if (action.type === 'skip') {
    if (natsPublish && instanceId && chatId) {
      natsPublish(`omni.turn.done.${instanceId}.${chatId}`, JSON.stringify({ action: 'skip', ...action.extra }));
    }
    return action.label;
  }

  if (!natsPublish || !instanceId || !chatId) {
    console.warn('[claude-sdk] No NATS publish available — reply dropped');
    return 'Turn close attempted but NATS publish not available.';
  }

  natsPublish(`omni.reply.${instanceId}.${chatId}`, buildReplyPayload(agent, chatId, instanceId, action.extra));
  return action.label;
}
```

E o builder do payload — `genie/src/services/executors/claude-sdk.ts:112-121`:

```typescript
function buildReplyPayload(agent: string, chatId: string, instanceId: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    content: '',
    agent,
    chat_id: chatId,
    instance_id: instanceId,
    timestamp: new Date().toISOString(),
    ...extra,
  });
}
```

`extra` carrega `content`, `react`, `media`, `message_id` etc. dependendo da action (`resolveAction` em `claude-sdk.ts:123-141`).

**Consumer outbound — quem entrega no Baileys:** `omni/packages/api/src/plugins/agent-dispatcher.ts:2931-2950`

```typescript
const natsProvider = new Ctor(provider.id, provider.name, {
  agentName,
  natsUrl,
  instanceId: instance.id,
  prefixSenderName: instance.agentPrefixSenderName ?? true,
  mode: providerMode,
  onReply: async (chatId, content, metadata) => {
    try {
      await sendTextMessage(channel, instance.id, chatId, content);
    } catch (error) {
      log.error('Failed to deliver agent reply', {
        chatId,
        instanceId: instance.id,
        providerId: provider.id,
        agent: (metadata as Record<string, unknown>)?.agent,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});
```

E a subscription que invoca o callback — `omni/packages/core/src/providers/nats-genie-provider.ts:192-220`:

```typescript
const subjectPrefix = `omni.reply.${this.config.instanceId}.`;
(async () => {
  for await (const msg of sub) {
    try {
      const data: NatsReplyMessage = JSON.parse(this.sc.decode(msg.data));
      const chatId =
        data.chat_id ||
        (msg.subject.startsWith(subjectPrefix)
          ? msg.subject.slice(subjectPrefix.length)
          : msg.subject.split('.').pop() || '');

      if (data.content && this.config.onReply) {
        await this.config.onReply(chatId, data.content, {
          agent: data.agent,
          auto_reply: data.auto_reply,
          timestamp: data.timestamp,
        });
      }
    } catch (error) { /* ... */ }
  }
})();
```

**Subjects auxiliares (turn lifecycle):** `genie/src/services/omni-bridge.ts:327-334`

```typescript
const turnSubs = ['omni.turn.open.>', 'omni.turn.done.>', 'omni.turn.nudge.>', 'omni.turn.timeout.>'];
for (const topic of turnSubs) {
  const sub = this.nc.subscribe(topic, { queue: 'genie-bridge' });
  this.processTurnEvents(sub);
}

const sessionResetSub = this.nc.subscribe('omni.session.reset.>', { queue: 'genie-bridge' });
```

### Consequência para nosso design

- **Para um agente externo (LinkMind) publicar respostas no WhatsApp**, basta publicar em `omni.reply.<instanceId>.<chatId>` com payload `{content, agent, chat_id, instance_id, timestamp}`. Não precisa interagir com `sendTextMessage` direto.
- **NATS core, sem JetStream** — não há durabilidade, ack, retry no caminho de reply. Se o Omni estiver caído quando o agente publicar, a mensagem é perdida (fire-and-forget).
- **Não há `OutgoingMessageSchema` no payload.** É um shape inline mínimo. Se quisermos campos extras (replyToId, buttons, media), precisamos verificar como o `extra` é interpretado lá no Baileys sender — só `content` é repassado pelo callback `onReply` no momento.
- **`omni.session.reset.<inst>.<chat>` existe** para limpar sessão de agente — útil para nosso comando `/reset`.

---

## Q3 — Genie + Claude Agent SDK + tools custom

### Resposta sintética

O Genie usa `@anthropic-ai/claude-agent-sdk` v0.2.119 in-process (não subprocess) via `ClaudeSdkProvider.runQuery({ prompt, options })`. O contexto da mensagem NATS chega como env vars (`OMNI_INSTANCE`, `OMNI_CHAT`, `OMNI_MESSAGE`, `OMNI_TURN_ID`, `OMNI_SENDER_NAME`, `OMNI_API_KEY`) injetadas no executor durante `spawn()`, e o conteúdo do user message é passado como `prompt` da query. Tools custom são registradas via **MCP server in-process** criado com `createSdkMcpServer({ name, tools: [tool(name, desc, zodSchema, handler)] })` e injetado em `options.mcpServers`. O provider `nats-genie` é **definido no repo Omni** (`packages/core/src/providers/nats-genie-provider.ts`); o lado Genie não tem provider análogo — ele tem `omni-bridge` (subscriber) + `ClaudeSdkOmniExecutor` (consumer-side).

### Evidência

**Import e uso do SDK:** `genie/src/services/executors/claude-sdk.ts:1-7`

```typescript
import type {
  HookCallback,
  HookCallbackMatcher,
  PreToolUseHookInput,
  Query,
  SyncHookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';
```

E o entrypoint da query — `genie/src/lib/providers/claude-sdk.ts:12-13` e `240`:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { HookCallbackMatcher, Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
...
const messages = query({ prompt, options });
```

Versão pinada — `genie/package.json:56`:

```json
"@anthropic-ai/claude-agent-sdk": "0.2.119",
```

**Como o contexto da mensagem NATS chega ao agente:** `genie/src/services/omni-bridge.ts:1163-1176` (no `spawnSession`)

```typescript
const raw = message as any;
const payloadEnv = raw.env as Record<string, string> | undefined;
const spawnEnv: Record<string, string> = {
  OMNI_API_KEY: payloadEnv?.OMNI_API_KEY ?? process.env.OMNI_API_KEY ?? '',
  OMNI_INSTANCE: payloadEnv?.OMNI_INSTANCE ?? message.instanceId,
  OMNI_CHAT: payloadEnv?.OMNI_CHAT ?? message.chatId,
  OMNI_MESSAGE: payloadEnv?.OMNI_MESSAGE ?? (raw.messageId as string) ?? '',
  OMNI_TURN_ID: payloadEnv?.OMNI_TURN_ID || '',
  OMNI_SENDER_NAME: payloadEnv?.OMNI_SENDER_NAME ?? message.sender ?? '',
};
```

E o user message é passado como `prompt` — `claude-sdk.ts:516-526`:

```typescript
const { messages: queryMessages } = state.provider.runQuery(
  {
    agentId: session.agentName,
    executorId: session.id,
    team: '',
    role: session.agentName,
    cwd: entry.dir || process.cwd(),
    model: entry.model,
    systemPrompt: state.claudeSessionId && !isTurnBased ? undefined : systemPrompt,
  },
  queryContent,
  permissionConfig,
  extraOptions,
  entry.sdk,
);
```

**MCP server in-process (registro de tools custom):** `genie/src/services/executors/claude-sdk.ts:258-281`

```typescript
async function createDoneMcpServer(env: Record<string, string>, natsPublish: NatsPublishFn | null) {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk');
  return createSdkMcpServer({
    name: 'genie-omni-tools',
    tools: [
      tool(
        'done',
        'Close this turn. REQUIRED after processing the user message. Sends a final response, reacts, or skips. Call exactly once per turn.',
        {
          text: z.string().optional().describe('Final message to the user'),
          media: z.string().optional().describe('File path for media attachment'),
          caption: z.string().optional().describe('Caption for media'),
          react: z.string().optional().describe('Emoji reaction (instead of text)'),
          skip: z.boolean().optional().describe('Close turn without sending anything'),
          reason: z.string().optional().describe('Internal reason for skipping'),
        },
        async (args) => {
          const result = handleDoneTool(args as Record<string, unknown>, env, natsPublish);
          return { content: [{ type: 'text' as const, text: result }] };
        },
      ),
    ],
  });
}
```

E é injetado nas options da query — `claude-sdk.ts:484-499`:

```typescript
const doneMcp = await createDoneMcpServer(state.env, this.natsPublish);
const sendMessageHooks: Partial<Record<string, HookCallbackMatcher[]>> | undefined = isTurnBased
  ? {
      PreToolUse: [
        {
          matcher: 'SendMessage',
          hooks: [createSendMessageOmniHook(state.env, this.natsPublish)],
        },
      ],
    }
  : undefined;
const extraOptions: Record<string, unknown> = {
  abortController: state.abortController,
  mcpServers: { 'genie-omni-tools': doneMcp },
  ...(sendMessageHooks && { hooks: sendMessageHooks }),
};
```

**Como o agente devolve a resposta — duas vias:**

1. **Tool `done`** — chamada explícita pelo modelo, publica `omni.reply.<inst>.<chat>` (ver Q2).
2. **Hook `PreToolUse` interceptando `SendMessage(to: "omni")`** — `claude-sdk.ts:204-255`:

```typescript
export function createSendMessageOmniHook(
  env: Record<string, string>,
  natsPublish: NatsPublishFn | null,
): HookCallback {
  return async (input): Promise<SyncHookJSONOutput> => {
    const hookInput = input as PreToolUseHookInput;
    if (hookInput.tool_name !== 'SendMessage') return {};
    const { recipient, body } = parseSendMessageInput(hookInput.tool_input);
    if (recipient !== 'omni') return {};
    ...
    natsPublish(`omni.reply.${instanceId}.${chatId}`, buildReplyPayload(agent, chatId, instanceId, { content: body }));
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Message delivered to user via omni bridge.',
      },
    };
  };
}
```

**Onde `nats-genie` está definido:** APENAS no repo Omni (`omni/packages/core/src/providers/nats-genie-provider.ts:85-99`):

```typescript
export class NatsGenieProvider implements IAgentProvider {
  readonly schema = 'nats-genie' as const;
  readonly mode: 'fire-and-forget' | 'turn-based';

  private nc: NatsConnection | null = null;
  private sc = StringCodec();
  private replySubscription: { unsubscribe: () => void } | null = null;

  constructor(
    readonly id: string,
    readonly name: string,
    private config: NatsGenieProviderConfig,
  ) {
    this.mode = config.mode ?? 'fire-and-forget';
  }
```

Registro/factory no Omni — `omni/packages/api/src/plugins/agent-dispatcher.ts:2914-2934`:

```typescript
function createNatsGenieProviderInstance(provider: AgentProvider, instance: DispatchInstance): IAgentProvider | null {
  const schemaConfig = (
    typeof provider.schemaConfig === 'object' && provider.schemaConfig !== null ? provider.schemaConfig : {}
  ) as Record<string, unknown>;

  const agentName = typeof schemaConfig.agentName === 'string' ? schemaConfig.agentName : '';
  ...
  const natsUrl = typeof schemaConfig.natsUrl === 'string' ? schemaConfig.natsUrl : 'localhost:4222';
  const providerMode = schemaConfig.mode === 'turn-based' ? ('turn-based' as const) : ('fire-and-forget' as const);
  ...
  const Ctor = _natsGenieProviderCtor!;
  const natsProvider = new Ctor(provider.id, provider.name, {
    agentName,
    natsUrl,
    instanceId: instance.id,
    ...
  });
```

E é amarrado a uma instância via `omni connect` (CLI) — `omni/packages/cli/src/commands/connect.ts:31-37`:

```typescript
const provider = await client.providers.create({
  name: `nats-genie-${agentName}`,
  schema: 'nats-genie',
  baseUrl: `nats://${natsUrl}`,
  schemaConfig: { agentName: agentEntry.name, agentDir: agentEntry.dir, natsUrl },
});
```

Default natsUrl no CLI — `connect.ts:98`:

```typescript
.option('--nats-url <url>', 'NATS server URL', 'localhost:4222')
```

**Onde o Omni passa a config das tools/MCP do agente:** O agente do lado Genie tem um "diretório" próprio (`genie agent register --dir <path>`), e a config SDK (incl. `mcpServers`, `tools`, `permissionMode`, `model`) vem do **frontmatter YAML do `AGENTS.md` na pasta do agente** — não vem do Omni. Tipo: `genie/src/lib/sdk-directory-types.ts:288`:

```typescript
mcpServers?: Record<string, SdkMcpServerConfig>;
```

E é traduzido pelo provider — `genie/src/lib/providers/claude-sdk.ts:65-81`:

```typescript
const SDK_CAST_FIELDS = ['effort', 'thinking', 'agents', 'mcpServers', 'outputFormat', 'sandbox', 'settings'] as const;
...
export function translateSdkConfig(sdkConfig: SdkDirectoryConfig): Partial<Options> {
  const opts: Record<string, unknown> = {};
  for (const key of SDK_TRUTHY_FIELDS) {
    if (sdkConfig[key]) opts[key] = sdkConfig[key];
  }
  for (const key of SDK_NULLABLE_FIELDS) {
    if (sdkConfig[key] != null) opts[key] = sdkConfig[key];
  }
  for (const key of SDK_CAST_FIELDS) {
    if (sdkConfig[key]) opts[key] = sdkConfig[key];
  }
  return opts as Partial<Options>;
}
```

**Permission mode default:** `claude-sdk.ts:236-237`:

```typescript
permissionMode: 'auto',
allowDangerouslySkipPermissions: true,
```

**"MCP Registry":** Não encontrei nenhum arquivo chamado MCP Registry. O que existe é registro **por agente** (via `sdkConfig.mcpServers` no frontmatter) + servers in-process (`createSdkMcpServer`) montados na hora pelo executor.

### Consequência para nosso design

- **Para registrar uma tool custom para o LinkMind**, temos duas opções:
  1. **Definir uma pasta de agente** com `AGENTS.md` cujo frontmatter especifique `mcpServers: { linkmind: { command: '...', args: [...] } }` (MCP stdio), e registrar via `genie agent register linkmind --dir <path>` + `omni connect <inst> linkmind`.
  2. **Forkar o `ClaudeSdkOmniExecutor`** para adicionar nosso próprio `createSdkMcpServer` in-process com tools específicas (saber, salvar contexto etc.) — mais invasivo, mas evita ter que rodar processo MCP externo.
- **Comunicação é estritamente "1 prompt = 1 turno"**. O agente DEVE chamar `done` ou usar `SendMessage(to: 'omni')` para fechar o turno. Sem isso, o omni-bridge não recebe o sinal `omni.turn.done.<inst>.<chat>` e fica considerando o agente "ocupado".
- **Env vars são o protocolo de injeção de contexto** — qualquer dado adicional (ex: user_id interno do nosso DB) precisa ser empacotado em `payload.env` no NATS message do Omni (mas isso requer alteração no Omni ou um middleware).
- **`nats-genie` é exclusivamente do lado Omni** — do lado Genie temos `omni-bridge` + executors. Para o LinkMind, "ser o Genie" = rodar processo com o omni-bridge e ter o agente registrado no diretório local.

---

## Q4 — Conexão pgserve em runtime

### Resposta sintética

O Genie conecta no Postgres via **Unix socket** em `$XDG_RUNTIME_DIR/pgserve` (fallback `/tmp/pgserve`) com nome de DB resolvido dinamicamente. Em **pgserve v3 (autopg)**, o Genie usa uma DB dedicada chamada `genie` (override via `GENIE_DB_NAME`); em pgserve v2, usa `postgres` e o daemon roteia para `app_<name>_<fp>` via SO_PEERCRED. Migrations são **embedded** no binário do Genie (`src/db/migrations/*.sql`) e rodam automaticamente no boot via `runMigrations()` (`src/lib/db-migrations.ts`). **O Omni tem seu próprio Postgres separado** (via Drizzle, package `@omni/db`), não compartilha schema com o Genie. Não há tool MCP de pgserve exposta ao agente — o agente acessa o DB do Genie só através das tools que o próprio Genie expõe (ou que você adiciona).

### Evidência

**Pacote `postgres` (postgres.js):** `genie/package.json:68`

```json
"postgres": "3.4.9",
```

E é declarado externo no build — `genie/package.json:29`:

```json
"build": "bun build src/genie.ts ... --external pgserve --external @khal-os/brain --external @anthropic-ai/claude-agent-sdk ..."
```

**Resolução do socket dir:** `genie/src/lib/db.ts:77-81`

```typescript
export function resolvePgserveSocketDir(): string {
  const xdg = process.env.XDG_RUNTIME_DIR;
  const base = xdg && xdg.length > 0 ? xdg : '/tmp';
  return join(base, 'pgserve');
}
```

**Resolução do DB name:** `genie/src/lib/db.ts:88-108`

```typescript
export function resolveDatabaseName(): string {
  const testDbName = process.env.GENIE_TEST_DB_NAME;
  if (testDbName && testDbName.length > 0) return testDbName;
  const explicit = process.env.GENIE_DB_NAME;
  if (explicit && explicit.length > 0) return explicit;
  return DB_NAME;
}
...
export const NATIVE_DB_NAME = 'genie';
```

`DB_NAME` é literalmente `'postgres'` (ofuscado para evitar scanners) — `db.ts:69-70`:

```typescript
const DB_NAME = ['post', 'gres'].join('');
export { DB_NAME };
```

**Auto-criação da DB `genie` em pgserve v3 (autopg):** `db.ts:122-160`

```typescript
async function ensureDatabaseExists(
  pgModule: any,
  transport: Transport,
  dbName: string,
): Promise<void> {
  if (dbName === DB_NAME) return; // maintenance DB always exists
  if (!isSafeDbIdent(dbName)) {
    throw new Error(`refusing to provision unsafe database identifier: ${JSON.stringify(dbName)}`);
  }
  const admin = pgModule(buildPgClientOptions(transport, DB_NAME, true));
  try {
    const rows = await admin<{ one: number }[]>`
      SELECT 1 AS one FROM pg_database WHERE datname = ${dbName}
    `;
    if (rows.length === 0) {
      await admin.unsafe(`CREATE DATABASE "${dbName}"`);
      process.stderr.write(`[genie] provisioned database "${dbName}" on direct postmaster\n`);
    }
  } ...
}
```

**Documentação confirmando pgserve v3 = autopg:** `genie/UPGRADING-pgserve-v3.md:24-29`

```
The dedicated v3 database name is `genie`; override with
`GENIE_DB_NAME=<name>` if you need something different (e.g. multi-tenant
hosts). `GENIE_ROLE_CUTOVER=0` continues to work; native-DB provisioning
is decoupled from the role-cutover kill-switch.
```

**Migrations embedded:** `genie/package.json:20-21`

```json
"src/db/migrations/",
"src/migrations/",
```

Estrutura de migrations — `genie/src/db/migrations/` (existem 58+ arquivos `*.sql`, ex: `058_claude_usage_view.sql`). Migrations rodam via `runMigrations()` importado em `db.ts:27`:

```typescript
import { runMigrations } from './db-migrations.js';
```

**Variáveis de ambiente relevantes:** `db.ts:57, 88-108, 169-177` + `genie/.claude/CLAUDE.md` (não-fonte, mas: `GENIE_HOME`, `GENIE_DB_NAME`, `GENIE_TEST_PG_PORT`, `GENIE_TEST_DB_NAME`, `PGPASSWORD`, `GENIE_PGSERVE_TIMEOUT`, `GENIE_PG_CONNECT_TIMEOUT`, `XDG_RUNTIME_DIR`).

Auth password — `db.ts:169-172`:

```typescript
export function resolvePgserveAuthPassword(): string {
  const password = process.env.PGPASSWORD;
  return password && password.length > 0 ? password : DB_NAME;
}
```

**Omni usa Drizzle, schema separado:** o `omni/CLAUDE.md` (system-reminder carregado durante a inspeção) lista `Database ORM: Drizzle | Database: PostgreSQL` e o omni tem `packages/db/` com `drizzle/` migrations. Omni e Genie podem rodar no mesmo `pgserve` (cada um cria sua própria DB) mas usam stacks diferentes (Drizzle vs raw SQL+postgres.js).

**Conexão usada pelo omni-bridge para registrar sessões:** `genie/src/services/omni-bridge.ts:239-244`

```typescript
this.pgProvider =
  config.pgProvider ??
  (async () => {
    const { getConnection } = await import('../lib/db.js');
    return (await getConnection()) as Sql;
  });
```

**Não há tool MCP de pgserve exposta ao agente.** A única ferramenta MCP injetada pelo executor é `genie-omni-tools` com a tool `done` (ver Q3). Acesso a DB pelo agente seria via:
- código direto (`import postgres` no handler de uma tool custom no diretório do agente), ou
- uma tool MCP que nós escrevermos que internamente chama `getConnection()`.

### Consequência para nosso design

- **LinkMind compartilha o pgserve com Genie.** Para isolamento, criamos uma DB própria (ex: `GENIE_DB_NAME=linkmind` no processo que rodar nossa lógica, OU uma DB lateral `linkmind` no mesmo postmaster) — pgserve v3 autopg cria sob demanda.
- **Migrations próprias do LinkMind precisam de mecanismo próprio.** O `runMigrations()` do Genie é proprietário das tabelas dele; não dá para piggyback. Provavelmente usaremos Drizzle (como Omni) ou nosso próprio runner SQL apontando para o socket `$XDG_RUNTIME_DIR/pgserve/.s.PGSQL.5432`.
- **String de conexão** (formato libpq): `host=/run/user/<uid>/pgserve dbname=<our-db> user=postgres password=<PGPASSWORD-ou-fallback>`. Em DSN: precisa usar driver que aceite Unix socket (postgres.js sim, drizzle-orm/postgres-js sim).
- **Não passamos `DATABASE_URL` para o agente.** Se quisermos que o agente persista coisas, ou criamos uma tool MCP nossa que abstrai isso, ou colocamos a conexão fora do contexto do agente (no processo que recebe `omni.message.*` antes de chamar a SDK — mas isso seria um fork do `ClaudeSdkOmniExecutor`).

---

## Bloqueios

1. **Repo `pgserve` (https://github.com/automagik-dev/pgserve) não foi clonado.** O usuário mencionou ele, mas como o Genie já documenta tudo o que precisamos (UPGRADING-pgserve-v3.md, `db.ts`), achei que clonar pgserve seria gold-plating sem ganho. Ainda em aberto se quisermos: o protocolo de admin.json/runtime.json (`PostmasterDiscovery` interface em `db.ts:215-219`) seria útil pra debug, e a flag `package.json: "pgserve": { "persist": true }` (`genie/package.json:110-112`) sugere que pgserve lê config do package.json — não inspeci­onei.

2. **`OutgoingMessageSchema` no NATS:** Confirmei que o payload de reply em `omni.reply.<inst>.<chat>` **não usa** `OutgoingMessageSchema`. Mas não está claro se existe outro caminho (ex: pelo `extra` do `buildReplyPayload` é possível passar `media: <path>` e `react: <emoji>` que o onReply ignora atualmente porque só repassa `content`). Para enviar mídia/reaction via NATS, precisaríamos confirmar se o omni-bridge ou o `onReply` (em `agent-dispatcher.ts`) tem suporte — pelo que vi em `agent-dispatcher.ts:2937-2949` só `content` é passado para `sendTextMessage`. Mídia provavelmente requer outra via.

3. **Headers NATS:** Confirmei via código que **não há headers** sendo setados em nenhum dos publishes (`js.publish(subject, data)` em `client.ts:229` e `nc.publish(topic, encoded)` em `nats-genie-provider.ts:137,270`). Mas a pergunta original assumia que headers existiam — fica confirmado que NÃO existem; toda metadata vai no body JSON.

4. **`MCP Registry` mencionado no enunciado:** Não encontrei nada com esse nome literal no Genie. O que existe é registro via frontmatter YAML de agente (`SdkDirectoryConfig.mcpServers`). Pode ser que "MCP Registry" seja um termo do README que se refere a esse mecanismo, ou seja outra coisa ainda não shipada.

---

## Surpresas / Descobertas adicionais

1. **NATS core vs JetStream — divisão clara:** O Omni usa JetStream **só** para o seu próprio fluxo interno canônico (`message.received.*`, `instance.connected.*`, etc.), com streams persistentes. A integração com Genie usa **NATS core puro** (`omni.message.*`, `omni.reply.*`, `omni.turn.*`, `omni.session.reset.*`, `omni.bridge.ping`, `omni.agent.heartbeat.*`) — sem stream, sem ack, sem retry. Isso é uma escolha deliberada e tem implicações: se o omni-bridge cair durante uma janela em que o Omni publica `omni.message.X.Y`, a mensagem é perdida (não há replay).

2. **Queue group `genie-bridge`:** `omni-bridge.ts:324`. Permite rodar múltiplas réplicas do bridge para load balancing — o NATS distribui mensagens entre os subscribers do queue group. Útil se quisermos HA.

3. **Heartbeat via NATS:** `omni-bridge.ts:14-17`, `agent-heartbeat.ts`. Enquanto um turno está aberto, o bridge publica `omni.agent.heartbeat.<inst>.<chat>` a cada ~30s para o omni saber que o agente ainda está vivo (evita nudge de inatividade aos 120s). Se construirmos o nosso próprio executor, temos que replicar isso.

4. **Pidfile + cleanup de zombies:** `omni-bridge.ts:364-419`. O bridge se protege contra duas instâncias rodando ao mesmo tempo via pidfile com `O_EXCL`. Se quisermos rodar nosso próprio bridge ao lado do oficial, temos que escolher path diferente (`getBridgePidfilePath()` em `lib/bridge-status.ts`).

5. **Tool `done` aceita `react`, `media`, `caption`, `skip`** — não só texto. O agente pode reagir com emoji em vez de texto, e o NATS reply payload carrega o `react` no `extra`. Isso vale ouro para UX.

6. **`SendMessage(to: "omni")` é um atalho convencional para enviar reply** sem precisar chamar `done` explicitamente. Útil para agentes que vêm de outras integrações (Claude Code nativo) onde `SendMessage` já é a primitiva natural.

7. **`turn-based` vs `fire-and-forget`** — modos diferentes do `nats-genie` provider. Em `turn-based`, o Omni espera o `omni.turn.done` antes de processar a próxima mensagem do mesmo chat; em `fire-and-forget`, dispara e segue. Default no `omni connect` é `turn-based` (recomendado para chat).

8. **`includePartialMessages: true` + `agentProgressSummaries: true`** são ligados por default no `ClaudeSdkProvider` (`claude-sdk.ts:221, 227`) — emite deltas parciais e progress summaries durante a query. Útil para observability e streaming de UI, mas pode aumentar latência/tokens se não filtrarmos.

9. **Genie tem schema `nats-genie` registrado no enum de `ProviderSchema`** (`omni/packages/core/src/types/agent.ts` — visto via grep, não lido), mas o factory `createProviderClient` **rejeita** `nats-genie` (`factory.ts:93-101`) — porque a construção real vai pelo `createNatsGenieProviderInstance` direto no agent-dispatcher. Pequena armadilha arquitetural para quem ler só o factory.

10. **MCP custom tools no Omni:** `omni` também tem `packages/mcp/` mencionado no CLAUDE.md (estrutura "MCP Server for AI assistants"), mas não foi necessário pra este spike. Pode ser útil mais à frente se quisermos expor APIs do Omni ao nosso agente.
