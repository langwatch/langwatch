/**
 * Synthetic Claude SDK and Claude API exports, shaped like the spans each source sends.
 * Spec: specs/trace-processing/claude-platform-telemetry.feature.
 */
import { randomBytes } from "node:crypto";

type AttributeValue = string | number;

export type ClaudeFixtureSpan = {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: number;
  scope: string;
  attributes: Record<string, AttributeValue>;
};

export const CLAUDE_SDK_SCOPE = "com.anthropic.sdk.python";
export const CLAUDE_API_SCOPE = "com.anthropic.claude-platform";

const SPAN_KIND = { INTERNAL: 1, SERVER: 2, CLIENT: 3 } as const;
const SERVICE_NAME = "claude-otel-test";

/** A fresh id per test: the usage claims live in a shared Redis for a day. */
export function newTraceId(): string {
  return randomBytes(16).toString("hex");
}

function newSpanId(): string {
  return randomBytes(8).toString("hex");
}

type Usage = { input: number; output: number; cacheRead?: number; cacheWrite?: number };

function usageAttributes({ input, output, cacheRead = 0, cacheWrite = 0 }: Usage) {
  return {
    "gen_ai.usage.input_tokens": input,
    "gen_ai.usage.output_tokens": output,
    "gen_ai.usage.cache_read.input_tokens": cacheRead,
    "gen_ai.usage.cache_write.input_tokens": cacheWrite,
  };
}

function messagesCreate({
  scope,
  parentSpanId,
  requestId,
  model,
  usage,
}: {
  scope: string;
  parentSpanId: string | null;
  requestId: string;
  model: string;
  usage: Usage;
}): ClaudeFixtureSpan {
  return {
    spanId: newSpanId(),
    parentSpanId,
    name: "anthropic.messages.create",
    kind: scope === CLAUDE_SDK_SCOPE ? SPAN_KIND.CLIENT : SPAN_KIND.SERVER,
    scope,
    attributes: {
      "gen_ai.provider.name": "anthropic",
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": model,
      "gen_ai.response.model": model,
      "anthropic.request.id": requestId,
      "anthropic.usage.cache_creation.ephemeral_5m_input_tokens": usage.cacheWrite ?? 0,
      "anthropic.usage.cache_creation.ephemeral_1h_input_tokens": 0,
      ...usageAttributes(usage),
    },
  };
}

function messagesModelRequest({
  parentSpanId,
  model,
  usage,
}: {
  parentSpanId: string;
  model: string;
  usage: Usage;
}): ClaudeFixtureSpan {
  return {
    spanId: newSpanId(),
    parentSpanId,
    name: "anthropic.model_request",
    kind: SPAN_KIND.INTERNAL,
    scope: CLAUDE_API_SCOPE,
    attributes: {
      "gen_ai.request.model": model,
      "gen_ai.response.model": model,
      ...usageAttributes(usage),
    },
  };
}

const OPUS = "claude-opus-4-7";
/** The request's usage: 1200 input and 85 output tokens of claude-opus-4-7. */
const REQUEST_USAGE: Usage = { input: 1200, output: 85 };
/** 1200 x 5e-6 + 85 x 2.5e-5, at the catalogue's claude-opus-4-7 rates. */
export const REQUEST_COST_USD = 0.008125;

/** The API's spans for one Messages request that ran two model requests. */
function apiSpansOf({
  parentSpanId,
  requestId,
  usage = REQUEST_USAGE,
}: {
  parentSpanId: string | null;
  requestId: string;
  usage?: Usage;
}): ClaudeFixtureSpan[] {
  const create = messagesCreate({
    scope: CLAUDE_API_SCOPE,
    parentSpanId,
    requestId,
    model: OPUS,
    usage,
  });
  return [
    create,
    messagesModelRequest({
      parentSpanId: create.spanId,
      model: OPUS,
      usage: { input: 500, output: 40 },
    }),
    messagesModelRequest({
      parentSpanId: create.spanId,
      model: OPUS,
      usage: { input: usage.input - 500, output: usage.output - 40 },
    }),
  ];
}

/** An SDK tool span reporting the result it sent back to the model. */
function sdkToolSpan(parentSpanId: string): ClaudeFixtureSpan {
  return {
    spanId: newSpanId(),
    parentSpanId,
    name: "anthropic.custom_tool_use get_weather",
    kind: SPAN_KIND.INTERNAL,
    scope: CLAUDE_SDK_SCOPE,
    attributes: {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "get_weather",
      "gen_ai.tool.call.id": "toolu_claude_otel_test",
      "gen_ai.tool.call.arguments": '{"city": "Amsterdam"}',
      "anthropic.tool_result.content": '[{"type": "text", "text": "14 C and cloudy"}]',
    },
  };
}

/** One Messages request traced by the SDK and by the API, which links to the SDK span. */
export function sdkAndApiRequest(): { sdk: ClaudeFixtureSpan[]; api: ClaudeFixtureSpan[] } {
  const requestId = `req_${newSpanId()}`;
  const sdkCreate = messagesCreate({
    scope: CLAUDE_SDK_SCOPE,
    parentSpanId: null,
    requestId,
    model: OPUS,
    usage: REQUEST_USAGE,
  });
  return {
    sdk: [sdkCreate, sdkToolSpan(sdkCreate.spanId)],
    api: apiSpansOf({ parentSpanId: sdkCreate.spanId, requestId }),
  };
}

/** The SDK sent the request twice; the first attempt timed out after the model had answered. */
export function retriedRequest(): {
  spans: ClaudeFixtureSpan[];
  firstAttempt: Usage;
  secondAttempt: Usage;
} {
  const firstRequestId = `req_${newSpanId()}`;
  const secondRequestId = `req_${newSpanId()}`;
  const firstAttempt: Usage = { input: 1200, output: 60 };
  const sdkCreate = messagesCreate({
    scope: CLAUDE_SDK_SCOPE,
    parentSpanId: null,
    requestId: secondRequestId,
    model: OPUS,
    usage: REQUEST_USAGE,
  });
  return {
    spans: [
      sdkCreate,
      ...apiSpansOf({
        parentSpanId: sdkCreate.spanId,
        requestId: firstRequestId,
        usage: firstAttempt,
      }),
      ...apiSpansOf({ parentSpanId: sdkCreate.spanId, requestId: secondRequestId }),
    ],
    firstAttempt,
    secondAttempt: REQUEST_USAGE,
  };
}

/** A Managed Agents turn: two model requests and an outcome evaluation, no messages.create. */
export function managedAgentsTurn(): ClaudeFixtureSpan[] {
  const turn: ClaudeFixtureSpan = {
    spanId: newSpanId(),
    parentSpanId: null,
    name: "anthropic.session.turn",
    kind: SPAN_KIND.INTERNAL,
    scope: CLAUDE_API_SCOPE,
    attributes: {
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.agent.name": "claude-otel-test-agent",
      "gen_ai.request.model": OPUS,
      "gen_ai.input.messages": JSON.stringify([
        { role: "user", parts: [{ type: "text", content: "Plan the trip." }] },
      ]),
    },
  };
  const modelRequest = (usage: Usage): ClaudeFixtureSpan => ({
    spanId: newSpanId(),
    parentSpanId: turn.spanId,
    name: "anthropic.model_request",
    kind: SPAN_KIND.INTERNAL,
    scope: CLAUDE_API_SCOPE,
    attributes: {
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": OPUS,
      ...usageAttributes(usage),
    },
  });
  return [
    turn,
    modelRequest({ input: 900, output: 40 }),
    modelRequest({ input: 600, output: 30 }),
    {
      spanId: newSpanId(),
      parentSpanId: turn.spanId,
      name: "anthropic.session.outcome_evaluation",
      kind: SPAN_KIND.INTERNAL,
      scope: CLAUDE_API_SCOPE,
      attributes: { "gen_ai.usage.input_tokens": 300, "gen_ai.usage.output_tokens": 20 },
    },
  ];
}

/**
 * Two SDK calls sharing a cached system prompt on claude-haiku-4-5: the first writes 15217
 * tokens to the cache, the second reads them. Each call has 15 fresh input and 22 output tokens.
 */
export function promptCacheCalls(): ClaudeFixtureSpan[] {
  const call = (cache: { cacheRead: number; cacheWrite: number }): ClaudeFixtureSpan => {
    const span = messagesCreate({
      scope: CLAUDE_SDK_SCOPE,
      parentSpanId: null,
      requestId: `req_${newSpanId()}`,
      model: "claude-haiku-4-5",
      usage: { input: 15_232, output: 22, ...cache },
    });
    span.attributes["gen_ai.response.model"] = "claude-haiku-4-5-20251001";
    return span;
  };
  return [call({ cacheRead: 0, cacheWrite: 15_217 }), call({ cacheRead: 15_217, cacheWrite: 0 })];
}

/**
 * 15 x 1e-6 + 22 x 5e-6 + 15217 x 1.25e-6 for the write, 15 x 1e-6 + 22 x 5e-6 + 15217 x 1e-7
 * for the read, at the catalogue's claude-haiku-4-5 rates.
 */
export const PROMPT_CACHE_CALLS_COST_USD = 0.02079295;

/** An OTLP/JSON export body holding the spans, grouped by instrumentation scope. */
export function otlpJsonBody({
  traceId,
  spans,
}: {
  traceId: string;
  spans: ClaudeFixtureSpan[];
}): ArrayBuffer {
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  const scopes = [...new Set(spans.map((span) => span.scope))];
  const body = {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: SERVICE_NAME } }],
        },
        scopeSpans: scopes.map((scope) => ({
          scope: { name: scope, version: "1.0.0" },
          spans: spans
            .filter((span) => span.scope === scope)
            .map((span) => ({
              traceId,
              spanId: span.spanId,
              ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
              name: span.name,
              kind: span.kind,
              startTimeUnixNano: String(nowNs - 2_000_000_000n),
              endTimeUnixNano: String(nowNs - 1_000_000_000n),
              attributes: Object.entries(span.attributes).map(([key, value]) => ({
                key,
                value: typeof value === "number" ? { intValue: value } : { stringValue: value },
              })),
              status: { code: 1 },
            })),
        })),
      },
    ],
  };
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
