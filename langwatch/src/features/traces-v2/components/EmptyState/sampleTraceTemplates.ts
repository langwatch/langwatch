import type {
  ChatMessage,
  SpanConfig,
  TraceConfig,
} from "~/components/ops/foundry/types";
import { shortId } from "~/components/ops/foundry/types";

/**
 * Hand-crafted trace templates for the empty-state sample loader. They
 * model what real Vercel AI SDK and Mastra integrations actually emit,
 * including the OTel GenAI semantic conventions (`gen_ai.system`,
 * `gen_ai.request.*`, `gen_ai.usage.*`, message events) plus each SDK's
 * own `ai.*` / `mastra.*` attributes.
 *
 * Why hand-crafted rather than reusing Foundry's `generateTrace`: that
 * generator picks structure randomly and is rich on fake data but
 * doesn't track any specific SDK convention. For the empty state we
 * want traces that look like ones a real customer would send, so a new
 * user can recognize the shape they'll see when they integrate.
 */

const MODELS: Array<{
  system: string;
  request: string;
  response: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}> = [
  {
    system: "openai",
    request: "gpt-4o",
    response: "gpt-4o-2024-08-06",
    inputTokens: 412,
    outputTokens: 184,
    cost: 0.0042,
  },
  {
    system: "openai",
    request: "gpt-4o-mini",
    response: "gpt-4o-mini-2024-07-18",
    inputTokens: 318,
    outputTokens: 96,
    cost: 0.0006,
  },
  {
    system: "anthropic",
    request: "claude-haiku-4-5",
    response: "claude-haiku-4-5-20251001",
    inputTokens: 524,
    outputTokens: 212,
    cost: 0.0017,
  },
  {
    system: "anthropic",
    request: "claude-sonnet-4-5",
    response: "claude-sonnet-4-5-20250514",
    inputTokens: 612,
    outputTokens: 348,
    cost: 0.0184,
  },
  {
    system: "google",
    request: "gemini-2.5-flash",
    response: "gemini-2.5-flash",
    inputTokens: 489,
    outputTokens: 156,
    cost: 0.0009,
  },
];

const SCENARIOS: Array<{
  systemPrompt: string;
  user: string;
  assistant: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  rag?: string[];
}> = [
  {
    systemPrompt:
      "You are a customer support agent. Resolve issues using the available tools.",
    user: "Where is my order #84219? It was supposed to arrive yesterday.",
    assistant:
      "I see your order shipped on Monday and is currently at the regional sort facility. The delay is from a weather event in your area; expected delivery is now tomorrow before 6pm.",
    toolName: "lookup_order",
    toolArgs: { order_id: "84219" },
    toolResult: JSON.stringify({
      status: "in_transit",
      delayed: true,
      expected: "2026-04-29T18:00:00Z",
    }),
  },
  {
    systemPrompt:
      "You are a research assistant. Cite sources from the retrieved context.",
    user: "Summarize the key findings on transformer scaling laws from the recent papers.",
    assistant:
      "Three converging findings: (1) compute-optimal training favors smaller models on more tokens (Hoffmann et al.), (2) instruction-tuning quality matters more than quantity past a threshold, and (3) sparse attention reduces inference cost ~40% with negligible quality loss.",
    rag: [
      "Hoffmann et al. (2022) demonstrate that for compute-optimal training, model size and dataset size should scale equally.",
      "Wang et al. (2024) show that 1k high-quality instruction examples outperform 100k mixed-quality examples on alignment benchmarks.",
      "Recent work on sparse attention mechanisms reduces transformer compute by ~40% with sub-1% accuracy loss on standard benchmarks.",
    ],
  },
  {
    systemPrompt:
      "You are a coding assistant. Generate runnable code with brief explanations.",
    user: "Write a Python function that retries a flaky HTTP call with exponential backoff.",
    assistant:
      "```python\nimport time, random\nfrom typing import Callable\n\ndef retry_with_backoff(fn: Callable, max_retries: int = 5, base_delay: float = 0.5):\n    for attempt in range(max_retries):\n        try:\n            return fn()\n        except Exception:\n            if attempt == max_retries - 1:\n                raise\n            delay = base_delay * (2 ** attempt) + random.uniform(0, 0.1)\n            time.sleep(delay)\n```\nThis grows the delay 0.5s → 1s → 2s → 4s → 8s with a small random jitter to avoid thundering herd.",
  },
  {
    systemPrompt:
      "You are a data analyst. Translate natural-language questions into SQL.",
    user: "How many users signed up last month who are still active?",
    assistant:
      "There were 1,247 signups in March 2026 and 891 (71.5%) are still active.",
    toolName: "execute_sql",
    toolArgs: {
      query:
        "SELECT COUNT(*) FROM users WHERE created_at >= '2026-03-01' AND created_at < '2026-04-01' AND last_active_at >= NOW() - INTERVAL '7 days'",
    },
    toolResult: JSON.stringify({ rows: [{ count: 891 }] }),
  },
  {
    systemPrompt:
      "You are a meeting assistant. Extract action items from transcripts.",
    user: "From yesterday's standup, what are the action items for the platform team?",
    assistant:
      "Three for the platform team: (1) finalize the rate-limit rollout plan by Thursday, (2) post-mortem the Tuesday outage, (3) review the auth migration RFC.",
  },
  {
    systemPrompt:
      "You are a translator. Preserve technical terminology and tone.",
    user: "Translate to Spanish: 'Our microservices use event-driven communication via Kafka.'",
    assistant:
      "Nuestros microservicios utilizan comunicación dirigida por eventos a través de Kafka.",
  },
];

interface BuildOptions {
  /** Wall-clock offset from "now" so each trace lands at a different time. */
  startedAtMs: number;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function buildResourceAttributes(serviceName: string): Record<string, string> {
  return {
    "service.name": serviceName,
    "service.version": "1.0.0",
  };
}

function buildMessageEvents(messages: ChatMessage[]) {
  // OTel GenAI semconv defines per-message events: `gen_ai.system.message`,
  // `gen_ai.user.message`, `gen_ai.assistant.message`. The body goes in
  // attributes.content per the convention.
  return messages.map((m, i) => ({
    name: `gen_ai.${m.role}.message`,
    attributes: { content: m.content, "gen_ai.message.index": i },
    offsetMs: i * 5,
  }));
}

// ──────────────────────────────────────────────────────────────────────
// Vercel AI SDK template
// ──────────────────────────────────────────────────────────────────────

/**
 * Mirrors `generateText` / `streamText` traces from the Vercel AI SDK.
 * Span names: `ai.generateText` (root), `ai.generateText.doGenerate` (LLM),
 * `ai.toolCall` (tool). Attributes follow the SDK's published telemetry
 * spec (https://sdk.vercel.ai/docs/ai-sdk-core/telemetry).
 */
export function buildVercelAiTrace({ startedAtMs }: BuildOptions): TraceConfig {
  const model = pickRandom(MODELS);
  const scenario = pickRandom(SCENARIOS);
  const userId = `user_${shortId()}`;
  const threadId = `thread_${shortId()}`;
  const traceId = shortId();
  const useTool = !!scenario.toolName;
  const useRag = !!scenario.rag;

  const baseMessages: ChatMessage[] = [
    { role: "system", content: scenario.systemPrompt },
    { role: "user", content: scenario.user },
  ];

  // For tool-using scenarios `llm1` produces a tool call (no text reply),
  // so we hand it just system+user and let `llm2` carry the assistant
  // content after the tool result lands. For tool-less scenarios `llm1`
  // *is* the final generation step, so the assistant message has to be
  // included — otherwise the span renders with input but no output.
  const llm1Messages: ChatMessage[] = useTool
    ? baseMessages
    : [...baseMessages, { role: "assistant", content: scenario.assistant }];

  const llm1Duration = 480 + Math.floor(Math.random() * 600);
  const toolDuration = useTool ? 80 + Math.floor(Math.random() * 200) : 0;
  const llm2Duration = useTool ? 320 + Math.floor(Math.random() * 400) : 0;
  const ragDuration = useRag ? 60 + Math.floor(Math.random() * 120) : 0;

  const ragSpan: SpanConfig | null = useRag
    ? {
        id: shortId(),
        name: "rag.retrieve",
        type: "rag",
        offsetMs: 8,
        durationMs: ragDuration,
        status: "ok",
        children: [],
        attributes: {
          "ai.operationId": "ai.retrieve",
        },
        rag: {
          contexts: scenario.rag!.map((content, idx) => ({
            document_id: `doc_${idx}`,
            chunk_id: `chunk_${idx}`,
            content,
          })),
        },
      }
    : null;

  const llm1: SpanConfig = {
    id: shortId(),
    name: "ai.generateText.doGenerate",
    type: "llm",
    offsetMs: 8 + ragDuration + 4,
    durationMs: llm1Duration,
    status: "ok",
    children: [],
    attributes: {
      // Vercel AI SDK telemetry attributes
      "ai.model.id": model.request,
      "ai.model.provider": model.system,
      "ai.operationId": "ai.generateText.doGenerate",
      "ai.usage.promptTokens": model.inputTokens,
      "ai.usage.completionTokens": Math.floor(model.outputTokens * 0.6),
      "ai.finishReason": useTool ? "tool-calls" : "stop",
      // OTel GenAI semantic conventions
      "gen_ai.system": model.system,
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": model.request,
      "gen_ai.request.temperature": 0.7,
      "gen_ai.request.max_tokens": 1024,
      "gen_ai.response.model": model.response,
      "gen_ai.response.id": `chatcmpl_${shortId()}`,
      "gen_ai.response.finish_reasons": useTool ? "tool_calls" : "stop",
      "gen_ai.usage.input_tokens": model.inputTokens,
      "gen_ai.usage.output_tokens": Math.floor(model.outputTokens * 0.6),
    },
    events: buildMessageEvents(llm1Messages),
    llm: {
      requestModel: model.request,
      responseModel: model.response,
      messages: llm1Messages,
      temperature: 0.7,
      metrics: {
        promptTokens: model.inputTokens,
        completionTokens: Math.floor(model.outputTokens * 0.6),
        cost: model.cost * 0.6,
      },
    },
  };

  const toolSpan: SpanConfig | null = useTool
    ? {
        id: shortId(),
        name: "ai.toolCall",
        type: "tool",
        offsetMs: llm1.offsetMs + llm1Duration + 4,
        durationMs: toolDuration,
        status: "ok",
        children: [],
        attributes: {
          "ai.toolCall.name": scenario.toolName!,
          "ai.toolCall.id": `call_${shortId()}`,
          "ai.operationId": "ai.toolCall",
          "gen_ai.tool.name": scenario.toolName!,
        },
        input: { type: "json", value: scenario.toolArgs ?? {} },
        output: { type: "text", value: scenario.toolResult ?? "" },
      }
    : null;

  const messagesAfterTool: ChatMessage[] = useTool
    ? [
        ...baseMessages,
        {
          role: "assistant",
          content: `[calling ${scenario.toolName}(${JSON.stringify(scenario.toolArgs ?? {})})]`,
        },
        { role: "tool", content: scenario.toolResult ?? "" },
        { role: "assistant", content: scenario.assistant },
      ]
    : [...baseMessages, { role: "assistant", content: scenario.assistant }];

  const llm2: SpanConfig | null = useTool
    ? {
        id: shortId(),
        name: "ai.generateText.doGenerate",
        type: "llm",
        offsetMs: (toolSpan?.offsetMs ?? 0) + toolDuration + 4,
        durationMs: llm2Duration,
        status: "ok",
        children: [],
        attributes: {
          "ai.model.id": model.request,
          "ai.model.provider": model.system,
          "ai.operationId": "ai.generateText.doGenerate",
          "ai.usage.promptTokens": Math.floor(model.inputTokens * 1.3),
          "ai.usage.completionTokens": Math.floor(model.outputTokens * 0.4),
          "ai.finishReason": "stop",
          "gen_ai.system": model.system,
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": model.request,
          "gen_ai.response.model": model.response,
          "gen_ai.response.id": `chatcmpl_${shortId()}`,
          "gen_ai.response.finish_reasons": "stop",
          "gen_ai.usage.input_tokens": Math.floor(model.inputTokens * 1.3),
          "gen_ai.usage.output_tokens": Math.floor(model.outputTokens * 0.4),
        },
        events: buildMessageEvents(messagesAfterTool),
        llm: {
          requestModel: model.request,
          responseModel: model.response,
          messages: messagesAfterTool,
          temperature: 0.7,
          metrics: {
            promptTokens: Math.floor(model.inputTokens * 1.3),
            completionTokens: Math.floor(model.outputTokens * 0.4),
            cost: model.cost * 0.4,
          },
        },
      }
    : null;

  const children: SpanConfig[] = [
    ...(ragSpan ? [ragSpan] : []),
    llm1,
    ...(toolSpan ? [toolSpan] : []),
    ...(llm2 ? [llm2] : []),
  ];

  const totalDuration =
    children.reduce((max, s) => Math.max(max, s.offsetMs + s.durationMs), 0) +
    4;

  const root: SpanConfig = {
    id: shortId(),
    name: "ai.generateText",
    type: "agent",
    offsetMs: 0,
    durationMs: totalDuration,
    status: "ok",
    children,
    attributes: {
      "ai.model.id": model.request,
      "ai.model.provider": model.system,
      "ai.operationId": "ai.generateText",
      "ai.prompt": scenario.user,
      "ai.response.text": scenario.assistant,
    },
    input: { type: "text", value: scenario.user },
    output: { type: "text", value: scenario.assistant },
  };

  return {
    id: traceId,
    name: "ai.generateText",
    description: "Vercel AI SDK · generateText",
    resourceAttributes: buildResourceAttributes("vercel-ai-app"),
    metadata: {
      userId,
      threadId,
      labels: ["sample", "vercel-ai-sdk"],
    },
    spans: [
      {
        ...root,
        attributes: {
          ...root.attributes,
          "service.startedAt": startedAtMs,
        },
      },
    ],
  };
}

// ──────────────────────────────────────────────────────────────────────
// Mastra agent template
// ──────────────────────────────────────────────────────────────────────

/**
 * Mirrors a Mastra agent run. Mastra emits a hierarchical workflow →
 * agent → step → llm/tool tree, with `mastra.*` attributes alongside
 * the GenAI semconv ones.
 */
export function buildMastraAgentTrace({
  startedAtMs,
}: BuildOptions): TraceConfig {
  const model = pickRandom(MODELS);
  const scenario = pickRandom(SCENARIOS);
  const userId = `user_${shortId()}`;
  const threadId = `thread_${shortId()}`;
  const traceId = shortId();
  const useTool = !!scenario.toolName;

  const baseMessages: ChatMessage[] = [
    { role: "system", content: scenario.systemPrompt },
    { role: "user", content: scenario.user },
  ];
  // Always include the assistant message so the LLM span renders both
  // input and output. Matches the Vercel template's tool-less branch.
  const llmMessages: ChatMessage[] = [
    ...baseMessages,
    { role: "assistant", content: scenario.assistant },
  ];

  const llmDuration = 520 + Math.floor(Math.random() * 540);
  const toolDuration = useTool ? 110 + Math.floor(Math.random() * 220) : 0;

  const llmSpan: SpanConfig = {
    id: shortId(),
    name: "llm.generate",
    type: "llm",
    offsetMs: 12,
    durationMs: llmDuration,
    status: "ok",
    children: [],
    attributes: {
      "mastra.component": "llm",
      "mastra.provider": model.system,
      "gen_ai.system": model.system,
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": model.request,
      "gen_ai.request.temperature": 0.5,
      "gen_ai.response.model": model.response,
      "gen_ai.response.id": `chatcmpl_${shortId()}`,
      "gen_ai.response.finish_reasons": useTool ? "tool_calls" : "stop",
      "gen_ai.usage.input_tokens": model.inputTokens,
      "gen_ai.usage.output_tokens": model.outputTokens,
    },
    events: buildMessageEvents(llmMessages),
    llm: {
      requestModel: model.request,
      responseModel: model.response,
      messages: llmMessages,
      temperature: 0.5,
      metrics: {
        promptTokens: model.inputTokens,
        completionTokens: model.outputTokens,
        cost: model.cost,
      },
    },
  };

  const toolSpan: SpanConfig | null = useTool
    ? {
        id: shortId(),
        name: `tool.${scenario.toolName}`,
        type: "tool",
        offsetMs: llmSpan.offsetMs + llmDuration + 6,
        durationMs: toolDuration,
        status: "ok",
        children: [],
        attributes: {
          "mastra.component": "tool",
          "mastra.tool.id": scenario.toolName!,
          "gen_ai.tool.name": scenario.toolName!,
        },
        input: { type: "json", value: scenario.toolArgs ?? {} },
        output: { type: "text", value: scenario.toolResult ?? "" },
      }
    : null;

  const stepChildren: SpanConfig[] = [llmSpan, ...(toolSpan ? [toolSpan] : [])];

  const stepDuration =
    stepChildren.reduce(
      (max, s) => Math.max(max, s.offsetMs + s.durationMs),
      0,
    ) + 6;

  const stepSpan: SpanConfig = {
    id: shortId(),
    name: "agent.step",
    type: "chain",
    offsetMs: 8,
    durationMs: stepDuration,
    status: "ok",
    children: stepChildren,
    attributes: {
      "mastra.component": "step",
      "mastra.step.kind": useTool ? "tool-call" : "respond",
    },
  };

  const agentDuration = stepSpan.offsetMs + stepDuration + 8;

  const root: SpanConfig = {
    id: shortId(),
    name: "agent.run",
    type: "agent",
    offsetMs: 0,
    durationMs: agentDuration,
    status: "ok",
    children: [stepSpan],
    attributes: {
      "mastra.component": "agent",
      "mastra.agent.name": "support-agent",
      "service.startedAt": startedAtMs,
    },
    input: { type: "text", value: scenario.user },
    output: { type: "text", value: scenario.assistant },
  };

  return {
    id: traceId,
    name: "agent.run",
    description: "Mastra · agent.run",
    resourceAttributes: buildResourceAttributes("mastra-agent"),
    metadata: {
      userId,
      threadId,
      labels: ["sample", "mastra"],
    },
    spans: [root],
  };
}

/**
 * Build a representative batch of sample traces — half Vercel AI SDK,
 * half Mastra — staggered across the last hour so the timeline looks
 * realistic.
 */
export function buildSampleTraces(count: number): TraceConfig[] {
  const now = Date.now();
  const builders = [buildVercelAiTrace, buildMastraAgentTrace];
  const traces: TraceConfig[] = [];
  for (let i = 0; i < count; i++) {
    const builder = builders[i % builders.length]!;
    // Spread across the last hour so the trace list has a natural
    // time-descending ordering rather than a wall of identical timestamps.
    const startedAtMs = now - Math.floor(Math.random() * 60 * 60 * 1000);
    traces.push(builder({ startedAtMs }));
  }
  return traces;
}
