/**
 * Synthesize gen_ai LLM spans from Claude Code OTLP log records.
 *
 * Why this exists: Claude Code 2.1.x dropped trace-span emission
 * entirely (binary strings of cli.js confirm no OTEL_TRACES_EXPORTER
 * read path, no /v1/traces POSTs in empirical capture). All
 * interesting telemetry — the user's prompt, the model name, the
 * token counts, the cost — now lives in OTLP LOG records under the
 * scope `com.anthropic.claude_code.events`, emitted as standalone
 * logs without trace/span context.
 *
 * Without a span, those calls never appear in /me/traces. To keep
 * the trace UI useful for Path B claude users we synthesize a span
 * per (session.id, prompt.id) pair by joining two event types in
 * the SAME OTLP batch:
 *   - `user_prompt` provides the user's text input (prompt attr) and the
 *     event.timestamp the user hit enter.
 *   - `api_request` provides model + input_tokens + output_tokens +
 *     cost_usd + cache_*_tokens + request_id + duration_ms.
 *
 * Both events carry `prompt.id` as the correlation key. They typically
 * land in the same export batch; pairing across batches is not
 * supported here (would require persistence). When only one half is
 * present we still emit a span with what we have so the call shows up.
 *
 * Limitation we cannot fix at this layer: Claude Code does NOT export
 * the assistant's response text in OTel — only token counts. Spans
 * therefore have an input but no output text. The PR body documents
 * this gap honestly; if anthropic re-adds output emission we'll fill
 * it from the new event without changing this synthesizer's shape.
 *
 * trace_id derivation = sha256(session.id) truncated to 32 hex (so
 * all turns in a session group as one trace). span_id derivation =
 * sha256(session.id || ":" || prompt.id) truncated to 16 hex (so
 * re-ingesting the same OTLP batch produces the same span row, which
 * is idempotent through the stored_spans ReplacingMergeTree).
 */
import { createHash } from "node:crypto";

import type { OtlpSpan } from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";

export const CLAUDE_CODE_EVENT_SCOPE = "com.anthropic.claude_code.events";

interface ClaudeCodeUserPromptEvent {
  promptText: string;
  promptId: string;
  sessionId: string;
  timeUnixNano: number;
  attrs: Record<string, string>;
  resourceAttrs: Record<string, string>;
}

interface ClaudeCodeApiRequestEvent {
  promptId: string;
  sessionId: string;
  timeUnixNano: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  durationMs: number;
  requestId: string;
  attrs: Record<string, string>;
  resourceAttrs: Record<string, string>;
}

export interface ClaudeCodeLogRecordView {
  scopeName: string;
  attrs: Record<string, string>;
  resourceAttrs: Record<string, string>;
  /**
   * The log record's timeUnixNano as a plain number (matches what
   * the project's existing normalizeOtlpUnixNano returns). Precision
   * loss past 2^53 ns is the same trade-off the trace path already
   * accepts; the synthesizer converts to bigint internally for the
   * start/end arithmetic.
   */
  timeUnixNano: number | null;
}

/**
 * Group claude_code.events log records into (user_prompt, api_request)
 * pairs by prompt.id and synthesize one OtlpSpan per pair. Records
 * from other scopes are ignored (the caller still persists them via
 * the normal log path).
 *
 * Returns spans in the order their api_request fired so downstream
 * recordSpan calls preserve causal ordering for the fold projection.
 */
export function synthesizeClaudeCodeSpans(
  records: ClaudeCodeLogRecordView[],
): OtlpSpan[] {
  const userPrompts = new Map<string, ClaudeCodeUserPromptEvent>();
  const apiRequests: ClaudeCodeApiRequestEvent[] = [];

  for (const r of records) {
    if (r.scopeName !== CLAUDE_CODE_EVENT_SCOPE) continue;
    const eventName = r.attrs["event.name"];
    const sessionId = r.attrs["session.id"];
    const promptId = r.attrs["prompt.id"];
    if (!eventName || !sessionId || !promptId) continue;

    const timeUnixNano = r.timeUnixNano ?? 0;

    if (eventName === "user_prompt") {
      const promptText = r.attrs.prompt ?? "";
      userPrompts.set(`${sessionId}:${promptId}`, {
        promptText,
        promptId,
        sessionId,
        timeUnixNano,
        attrs: r.attrs,
        resourceAttrs: r.resourceAttrs,
      });
    } else if (eventName === "api_request") {
      apiRequests.push({
        promptId,
        sessionId,
        timeUnixNano,
        model: r.attrs.model ?? "unknown",
        inputTokens: parseIntSafe(r.attrs.input_tokens),
        outputTokens: parseIntSafe(r.attrs.output_tokens),
        cacheReadTokens: parseIntSafe(r.attrs.cache_read_tokens),
        cacheCreationTokens: parseIntSafe(r.attrs.cache_creation_tokens),
        costUsd: parseFloatSafe(r.attrs.cost_usd),
        durationMs: parseIntSafe(r.attrs.duration_ms),
        requestId: r.attrs.request_id ?? "",
        attrs: r.attrs,
        resourceAttrs: r.resourceAttrs,
      });
    }
  }

  const spans: OtlpSpan[] = [];
  for (const req of apiRequests) {
    const userPrompt = userPrompts.get(`${req.sessionId}:${req.promptId}`);
    spans.push(buildLlmSpan(req, userPrompt));
  }
  return spans;
}

function buildLlmSpan(
  req: ClaudeCodeApiRequestEvent,
  userPrompt: ClaudeCodeUserPromptEvent | undefined,
): OtlpSpan {
  const traceIdHex = deriveTraceIdHex(req.sessionId);
  const spanIdHex = deriveSpanIdHex(req.sessionId, req.promptId);

  const durationNs = BigInt(req.durationMs) * 1_000_000n;
  const endTimeNs =
    req.timeUnixNano > 0 ? BigInt(req.timeUnixNano) : nowNs();
  const startTimeNs = endTimeNs > durationNs ? endTimeNs - durationNs : endTimeNs;

  const inputMessages = userPrompt
    ? JSON.stringify([{ role: "user", content: userPrompt.promptText }])
    : "[]";

  // gen_ai semantic conventions + langwatch canonical mirrors. The
  // OpenInferenceExtractor on the receiver maps gen_ai.* into the
  // langwatch.* canonical fields, but we set both explicitly so the
  // trace renders correctly even when the extractor regresses.
  const attrs: Array<{ key: string; value: { stringValue: string } | { intValue: string } | { doubleValue: number } }> = [
    kv("gen_ai.system", "anthropic"),
    kv("gen_ai.operation.name", "chat"),
    kv("gen_ai.request.model", req.model),
    intKv("gen_ai.usage.input_tokens", req.inputTokens),
    intKv("gen_ai.usage.output_tokens", req.outputTokens),
    kv("gen_ai.conversation.id", req.sessionId),
    kv("langwatch.span.type", "llm"),
    kv("langwatch.input.value", inputMessages),
    kv("langwatch.input.type", "json"),
    kv("langwatch.model", req.model),
    intKv("langwatch.input_tokens", req.inputTokens),
    intKv("langwatch.output_tokens", req.outputTokens),
    intKv("langwatch.cache_read_tokens", req.cacheReadTokens),
    intKv("langwatch.cache_creation_tokens", req.cacheCreationTokens),
    doubleKv("langwatch.cost.usd", req.costUsd),
    kv("langwatch.thread.id", req.sessionId),
    kv("langwatch.request_id", req.requestId),
    kv("langwatch.synthesized_from", "claude_code.api_request+user_prompt"),
  ];

  return {
    traceId: traceIdHex,
    spanId: spanIdHex,
    parentSpanId: null,
    name: "claude_code.api_request",
    // SpanKind.CLIENT in OTLP enum = 3
    kind: 3,
    startTimeUnixNano: startTimeNs.toString(),
    endTimeUnixNano: endTimeNs.toString(),
    attributes: attrs as any,
    events: [],
    links: [],
    status: { message: null, code: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as OtlpSpan;
}

function deriveTraceIdHex(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}

function deriveSpanIdHex(sessionId: string, promptId: string): string {
  return createHash("sha256")
    .update(`${sessionId}:${promptId}`)
    .digest("hex")
    .slice(0, 16);
}

function parseIntSafe(v: string | undefined): number {
  if (!v) return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

function parseFloatSafe(v: string | undefined): number {
  if (!v) return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function kv(k: string, v: string): { key: string; value: { stringValue: string } } {
  return { key: k, value: { stringValue: v } };
}

function intKv(k: string, v: number): { key: string; value: { intValue: string } } {
  return { key: k, value: { intValue: String(v) } };
}

function doubleKv(k: string, v: number): { key: string; value: { doubleValue: number } } {
  return { key: k, value: { doubleValue: v } };
}

function nowNs(): bigint {
  return BigInt(Date.now()) * 1_000_000n;
}
