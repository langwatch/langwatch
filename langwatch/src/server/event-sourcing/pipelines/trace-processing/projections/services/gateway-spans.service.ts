import { z } from "zod";
import type { NormalizedSpan } from "../../schemas/spans";
import { NormalizedStatusCode } from "../../schemas/spans";

/**
 * Per-request gateway span bookkeeping on the trace fold.
 *
 * A trace is one client traceparent, but the gateway serves one REQUEST per
 * span it emits, and billing is per request: N calls under one traceparent
 * must produce N spend records, each under its own gateway_request_id. The
 * trace-level attribute map is first-wins, so it can only ever carry the
 * FIRST request's id; this list is where every request survives.
 *
 * Transport: a reserved key on the trace attribute map, because fold state
 * round-trips through the trace_summaries columns between batches (the
 * read-back store rebuilds state from the row), and the attribute map is
 * the one open-shaped field that survives that round-trip. Same transport
 * the cache-token sums already use.
 */
export const GATEWAY_SPANS_ATTR = "langwatch.reserved.gateway_spans";
export const GATEWAY_SPANS_OVERFLOW_ATTR =
  "langwatch.reserved.gateway_spans_overflow";

/**
 * Hard cap on tracked requests per trace. Sits under the fold's own
 * MAX_PROCESSED_SPANS (512) so the list can never grow past what the fold
 * derives anyway. Past the cap the overflow flag is raised so the loss is
 * visible instead of silent.
 */
export const MAX_GATEWAY_SPANS = 500;

export const gatewaySpanEntrySchema = z.object({
  requestId: z.string(),
  virtualKeyId: z.string(),
  model: z.string(),
  /** ModelProvider row id when the span carries it; empty until the gateway stamps it. */
  modelProviderId: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  reasoningTokens: z.number(),
  costUsd: z.number(),
  status: z.enum(["success", "error"]),
  /** Gateway error taxonomy token (error.type span attr), empty on success. */
  errorClass: z.string(),
  httpStatus: z.number(),
  /** External end-user id once the gateway captures it; empty until then. */
  endUserId: z.string(),
  /**
   * Caller metadata echo (x-langwatch-metadata, raw JSON object string).
   * Optional with a default so entries stored before the field existed
   * still parse; the spend event row carries it verbatim.
   */
  metadata: z.string().optional().default(""),
  /** Request time (span start), unix ms. Period placement anchors here. */
  occurredAtMs: z.number(),
  durationMs: z.number(),
});

export type GatewaySpanEntry = z.infer<typeof gatewaySpanEntrySchema>;

const gatewaySpanListSchema = z.array(gatewaySpanEntrySchema);

/**
 * Parse the reserved attribute back into typed entries. Garbage (missing
 * key, truncated JSON, wrong shape) yields an empty list rather than a
 * throw: a malformed bookkeeping value must never poison the fold or the
 * reactors reading it.
 */
export function parseGatewaySpans(
  attributes: Record<string, string>,
): GatewaySpanEntry[] {
  const raw = attributes[GATEWAY_SPANS_ATTR];
  if (!raw) return [];
  try {
    const parsed = gatewaySpanListSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function hasGatewaySpansOverflow(
  attributes: Record<string, string>,
): boolean {
  return attributes[GATEWAY_SPANS_OVERFLOW_ATTR] === "true";
}

/**
 * Append one entry into the reserved attribute on the (already-merged)
 * attribute map the fold is building. Idempotent per requestId: re-folding
 * the same span keeps the first entry, so at-least-once span delivery
 * cannot double a request. At the cap the entry is dropped and the
 * overflow flag raised.
 */
export function appendGatewaySpan(
  attributes: Record<string, string>,
  entry: GatewaySpanEntry,
): void {
  const existing = parseGatewaySpans(attributes);
  if (existing.some((e) => e.requestId === entry.requestId)) return;
  if (existing.length >= MAX_GATEWAY_SPANS) {
    attributes[GATEWAY_SPANS_OVERFLOW_ATTR] = "true";
    return;
  }
  existing.push(entry);
  attributes[GATEWAY_SPANS_ATTR] = JSON.stringify(existing);
}

function coerceInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/**
 * Build the entry for a gateway-emitted span, or null for every other
 * span. Detection is the gateway's own markers: both the request id and
 * the VK id must be present (they are stamped together by the emitter).
 * Token/cost numbers are passed in by the fold so this entry always
 * matches what the trace totals accumulated for the same span, including
 * the skip-token-accumulation case.
 */
export function buildGatewaySpanEntry({
  span,
  promptTokens,
  completionTokens,
  costUsd,
  cacheReadTokens,
  cacheCreationTokens,
  reasoningTokens,
  model,
}: {
  span: NormalizedSpan;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
  model: string;
}): GatewaySpanEntry | null {
  const attrs = span.spanAttributes;
  const requestId = attrs["langwatch.gateway_request_id"];
  const virtualKeyId = attrs["langwatch.virtual_key_id"];
  if (typeof requestId !== "string" || requestId.length === 0) return null;
  if (typeof virtualKeyId !== "string" || virtualKeyId.length === 0)
    return null;

  const errorClassRaw = attrs["error.type"];
  const isError = span.statusCode === NormalizedStatusCode.ERROR;
  const modelProviderId = attrs["langwatch.model_provider_id"];
  const endUserId = attrs["langwatch.end_user_id"];
  const requestMetadata = attrs["langwatch.reserved.request_metadata"];

  return {
    requestId,
    virtualKeyId,
    model,
    modelProviderId:
      typeof modelProviderId === "string" ? modelProviderId : "",
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    cacheReadTokens,
    cacheWriteTokens: cacheCreationTokens,
    reasoningTokens,
    costUsd,
    status: isError ? "error" : "success",
    errorClass:
      typeof errorClassRaw === "string" && isError ? errorClassRaw : "",
    httpStatus: coerceInt(attrs["http.response.status_code"]),
    endUserId: typeof endUserId === "string" ? endUserId : "",
    metadata: typeof requestMetadata === "string" ? requestMetadata : "",
    occurredAtMs: span.startTimeUnixMs,
    durationMs: Math.max(0, span.endTimeUnixMs - span.startTimeUnixMs),
  };
}
