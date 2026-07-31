import type {
  AttributeMap,
  AttributeValue,
  CanonicalSpan,
  CanonicalSpanEvent,
  CanonicalSpanLink,
  PIIRedactionLevel,
  PIIRedactionStatus,
  SpanCost,
  SpanIO,
  SpanKind,
  SpanStatusCode,
  SpanUsage,
} from "~/server/event-sourcing/trace-processing/schema";
import type {
  NormalizedAttributes,
  NormalizedSpan,
} from "../ingest/normalizedSpan";
import {
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "../ingest/normalizedSpan";
import { ATTR_KEYS } from "./extractors/_constants";

/**
 * The last step of span ingest: a `NormalizedSpan` — OTLP already decoded and
 * its attributes already canonicalised by `CanonicalizeSpanAttributesService` —
 * becomes the flat `CanonicalSpan` the `recordSpan` command accepts.
 *
 * This is the trace-side counterpart of `canonicalizeLogRequest`. Without it
 * the raw `RecordSpanCommandData` envelope reached the event log verbatim, so
 * `spanReceived`'s id resolver read `data.traceId` off an envelope that carries
 * it at `data.span.traceId` and every event was written with an empty
 * `AggregateId` — leaving both aggregate-scoped folds unable to key a row.
 */

const SPAN_KIND_BY_ORDINAL: Record<NormalizedSpanKind, SpanKind> = {
  [NormalizedSpanKind.UNSPECIFIED]: "UNSPECIFIED",
  [NormalizedSpanKind.INTERNAL]: "INTERNAL",
  [NormalizedSpanKind.SERVER]: "SERVER",
  [NormalizedSpanKind.CLIENT]: "CLIENT",
  [NormalizedSpanKind.PRODUCER]: "PRODUCER",
  [NormalizedSpanKind.CONSUMER]: "CONSUMER",
};

const STATUS_CODE_BY_ORDINAL: Record<NormalizedStatusCode, SpanStatusCode> = {
  [NormalizedStatusCode.UNSET]: "UNSET",
  [NormalizedStatusCode.OK]: "OK",
  [NormalizedStatusCode.ERROR]: "ERROR",
};

/** The keys an explicit LangWatch input/output is declared under. */
const EXPLICIT_INPUT_KEYS = [ATTR_KEYS.LANGWATCH_INPUT] as const;
const EXPLICIT_OUTPUT_KEYS = [ATTR_KEYS.LANGWATCH_OUTPUT] as const;
/** Ordered fallbacks, tried only once every explicit key has missed. */
const FALLBACK_INPUT_KEYS = [
  ATTR_KEYS.GEN_AI_INPUT_MESSAGES,
  ATTR_KEYS.GEN_AI_PROMPT,
  ATTR_KEYS.AI_PROMPT,
  ATTR_KEYS.INPUT_VALUE,
  ATTR_KEYS.INPUT,
] as const;
const FALLBACK_OUTPUT_KEYS = [
  ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES,
  ATTR_KEYS.GEN_AI_COMPLETION,
  ATTR_KEYS.AI_RESPONSE_TEXT,
  ATTR_KEYS.AI_RESPONSE,
  ATTR_KEYS.OUTPUT_VALUE,
  ATTR_KEYS.OUTPUT,
] as const;

const PROMPT_ID_KEY = "langwatch.prompt.id";
const PROMPT_VERSION_ID_KEY = "langwatch.prompt.version.id";
const PROMPT_VERSION_NUMBER_KEY = "langwatch.prompt.version.number";

const EXCEPTION_EVENT_NAME = "exception";

export interface CanonicalizeSpanArgs {
  readonly normalized: NormalizedSpan;
  readonly piiRedactionLevel: PIIRedactionLevel;
  /** The customer's clock: when the span was accepted at the edge. */
  readonly occurredAt: number;
  /** Our own boundary's clock, defaulted by the caller's `Date.now()`. */
  readonly acceptedAt: number;
}

export function canonicalizeSpan({
  normalized,
  piiRedactionLevel,
  occurredAt,
  acceptedAt,
}: CanonicalizeSpanArgs): CanonicalSpan {
  const attributes = toAttributeMap(normalized.spanAttributes);
  const resourceAttributes = toAttributeMap(normalized.resourceAttributes);
  const events = normalized.events.map(
    (event): CanonicalSpanEvent => ({
      name: event.name,
      timeUnixMs: nonNegativeInt(event.timeUnixMs),
      attributes: toAttributeMap(event.attributes),
    }),
  );
  const startTimeUnixMs = nonNegativeInt(normalized.startTimeUnixMs);
  const metrics = readMetricsBlob(normalized.spanAttributes);
  const timestamps = readTimestampsBlob(normalized.spanAttributes);

  return {
    tenantId: normalized.tenantId,

    traceId: normalized.traceId,
    spanId: normalized.spanId,
    parentSpanId: normalized.parentSpanId,

    name: normalized.name,
    kind: SPAN_KIND_BY_ORDINAL[normalized.kind] ?? "UNSPECIFIED",

    startTimeUnixMs,
    endTimeUnixMs: nonNegativeInt(normalized.endTimeUnixMs),

    statusCode:
      normalized.statusCode === null
        ? "UNSET"
        : (STATUS_CODE_BY_ORDINAL[normalized.statusCode] ?? "UNSET"),
    statusMessage: normalized.statusMessage,
    exceptionMessage: exceptionMessageOf(normalized, attributes),

    attributes,
    resourceAttributes,
    instrumentationScopeName: normalized.instrumentationScope.name,
    instrumentationScopeVersion: normalized.instrumentationScope.version,

    events,
    links: normalized.links.map(
      (link): CanonicalSpanLink => ({
        traceId: link.traceId,
        spanId: link.spanId,
        attributes: toAttributeMap(link.attributes),
      }),
    ),

    spanType: readString(attributes, ATTR_KEYS.SPAN_TYPE),
    model: modelOf(attributes),
    usage: usageOf(normalized.spanAttributes, metrics),
    cost: costOf(normalized, metrics),
    io: ioOf(normalized.spanAttributes),
    timeToFirstTokenMs: timeToFirstTokenOf({
      attributes: normalized.spanAttributes,
      metrics,
      timestamps,
      startTimeUnixMs,
    }),
    timeToLastTokenMs: timeToLastTokenOf({ timestamps, startTimeUnixMs }),

    prompt: promptOf(attributes),

    piiRedactionLevel,
    piiRedactionStatus: piiRedactionStatusOf(attributes),

    occurredAt: nonNegativeInt(occurredAt),
    acceptedAt: nonNegativeInt(acceptedAt),
  };
}

/**
 * `attributeValueSchema` admits scalars and arrays of scalars only, but
 * `parseJsonStringValues` has already turned every JSON-shaped string into an
 * object. Re-serialising those is what keeps the map schema-valid; the parsed
 * form is still read directly, off `NormalizedAttributes`, wherever structure
 * actually matters (IO text, the metrics and timestamps blobs).
 */
function toAttributeMap(attributes: NormalizedAttributes): AttributeMap {
  const out: AttributeMap = {};
  for (const [key, raw] of Object.entries(attributes)) {
    const value = toAttributeValue(raw);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function toAttributeValue(raw: unknown): AttributeValue | undefined {
  const scalar = toScalar(raw);
  if (scalar !== undefined) return scalar;
  if (Array.isArray(raw)) {
    const items: (string | number | boolean)[] = [];
    for (const item of raw) {
      const value = toScalar(item);
      items.push(value === undefined ? stringify(item) : value);
    }
    return items;
  }
  if (raw === null || raw === undefined) return undefined;
  return stringify(raw);
}

/** Zero, `0.0` and `false` are reported values and survive as themselves. */
function toScalar(raw: unknown): string | number | boolean | undefined {
  if (typeof raw === "string" || typeof raw === "boolean") return raw;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === "bigint") {
    return Number.isSafeInteger(Number(raw)) ? Number(raw) : raw.toString();
  }
  return undefined;
}

function stringify(raw: unknown): string {
  try {
    return JSON.stringify(raw) ?? String(raw);
  } catch {
    return String(raw);
  }
}

function nonNegativeInt(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function readString(attributes: AttributeMap, key: string): string | null {
  const value = attributes[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function modelOf(attributes: AttributeMap): string | null {
  return (
    readString(attributes, ATTR_KEYS.GEN_AI_RESPONSE_MODEL) ??
    readString(attributes, ATTR_KEYS.GEN_AI_REQUEST_MODEL) ??
    readString(attributes, ATTR_KEYS.LLM_MODEL_NAME) ??
    readString(attributes, ATTR_KEYS.AI_MODEL)
  );
}

function piiRedactionStatusOf(
  attributes: AttributeMap,
): PIIRedactionStatus | null {
  const value = attributes[ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_STATUS];
  return value === "partial" || value === "none" ? value : null;
}

function promptOf(attributes: AttributeMap): CanonicalSpan["prompt"] {
  const promptId = readString(attributes, PROMPT_ID_KEY);
  if (promptId === null) return null;
  const versionNumber = readNumber(attributes[PROMPT_VERSION_NUMBER_KEY]);
  return {
    promptId,
    versionId: readString(attributes, PROMPT_VERSION_ID_KEY),
    versionNumber,
  };
}

/**
 * The exception event's own message outranks the attribute copy: an
 * instrumentation that records both puts the stack-bearing one on the event.
 */
function exceptionMessageOf(
  normalized: NormalizedSpan,
  attributes: AttributeMap,
): string | null {
  for (const event of normalized.events) {
    if (event.name !== EXCEPTION_EVENT_NAME) continue;
    const message = event.attributes[ATTR_KEYS.EXCEPTION_MESSAGE];
    if (typeof message === "string" && message.length > 0) return message;
  }
  return (
    readString(attributes, ATTR_KEYS.EXCEPTION_MESSAGE) ??
    readString(attributes, ATTR_KEYS.ERROR_MESSAGE)
  );
}

function readNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "bigint") return Number(raw);
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readCount(
  attributes: NormalizedAttributes,
  key: string,
): number | null {
  return readNumber(attributes[key]);
}

/** The first key that reported anything wins; a reported zero ends the search. */
function firstCount(
  attributes: NormalizedAttributes,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = readCount(attributes, key);
    if (value !== null) return value;
  }
  return null;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

/**
 * `langwatch.metrics` arrives in two shapes: the TypeScript SDK wraps it as
 * `{ type: "json", value: {...} }` with camelCase keys, the Python SDK exports
 * the fields directly in snake_case
 * (specs/trace-processing/sdk-timing-and-metrics-canonicalisation.feature).
 */
interface MetricsBlob {
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly cost: number | null;
  readonly firstTokenMs: number | null;
}

function readMetricsBlob(attributes: NormalizedAttributes): MetricsBlob {
  const raw = unwrapJsonValue(attributes[ATTR_KEYS.LANGWATCH_METRICS]);
  if (!isRecord(raw)) {
    return {
      promptTokens: null,
      completionTokens: null,
      reasoningTokens: null,
      cost: null,
      firstTokenMs: null,
    };
  }
  return {
    promptTokens: readNumber(raw.promptTokens ?? raw.prompt_tokens),
    completionTokens: readNumber(raw.completionTokens ?? raw.completion_tokens),
    reasoningTokens: readNumber(raw.reasoningTokens ?? raw.reasoning_tokens),
    cost: readNumber(raw.cost),
    firstTokenMs: readNumber(raw.firstTokenMs ?? raw.first_token_ms),
  };
}

/** `langwatch.timestamps` carries unix epoch milliseconds, not offsets. */
interface TimestampsBlob {
  readonly firstTokenAt: number | null;
  readonly finishedAt: number | null;
}

function readTimestampsBlob(attributes: NormalizedAttributes): TimestampsBlob {
  const raw = unwrapJsonValue(attributes[ATTR_KEYS.LANGWATCH_TIMESTAMPS]);
  if (!isRecord(raw)) return { firstTokenAt: null, finishedAt: null };
  return {
    firstTokenAt: readNumber(raw.first_token_at ?? raw.firstTokenAt),
    finishedAt: readNumber(raw.finished_at ?? raw.finishedAt),
  };
}

/** Unwraps the SDK's `{ type: "json", value: … }` envelope when present. */
function unwrapJsonValue(raw: unknown): unknown {
  if (isRecord(raw) && raw.type === "json" && "value" in raw) return raw.value;
  return raw;
}

function usageOf(
  attributes: NormalizedAttributes,
  metrics: MetricsBlob,
): SpanUsage {
  return {
    inputTokens:
      firstCount(attributes, [
        ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS,
        ATTR_KEYS.GEN_AI_USAGE_PROMPT_TOKENS,
        ATTR_KEYS.AI_USAGE_INPUT_TOKENS,
      ]) ?? metrics.promptTokens,
    outputTokens:
      firstCount(attributes, [
        ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS,
        ATTR_KEYS.GEN_AI_USAGE_COMPLETION_TOKENS,
      ]) ?? metrics.completionTokens,
    reasoningTokens:
      firstCount(attributes, [
        ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS,
        ATTR_KEYS.AI_USAGE_REASONING_TOKENS,
      ]) ?? metrics.reasoningTokens,
    cacheReadTokens: firstCount(attributes, [
      ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
      ATTR_KEYS.GEN_AI_USAGE_CACHED_INPUT_TOKENS,
      ATTR_KEYS.AI_USAGE_CACHE_READ_TOKENS,
      ATTR_KEYS.AI_USAGE_CACHED_INPUT_TOKENS,
    ]),
    cacheWriteTokens: firstCount(attributes, [
      ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
      ATTR_KEYS.AI_USAGE_CACHE_WRITE_TOKENS,
    ]),
    estimated: attributes[ATTR_KEYS.LANGWATCH_TOKENS_ESTIMATED] === true,
  };
}

/**
 * Normalization leaves both costs null — it has no pricing context — so an
 * explicitly reported cost is the only one a span carries at this point.
 */
function costOf(normalized: NormalizedSpan, metrics: MetricsBlob): SpanCost {
  const reported =
    normalized.cost ??
    readCount(normalized.spanAttributes, ATTR_KEYS.LANGWATCH_SPAN_COST) ??
    metrics.cost;
  const nonBilled =
    normalized.nonBilledCost ??
    readCount(normalized.spanAttributes, ATTR_KEYS.LANGWATCH_COST_NON_BILLABLE);
  return { cost: reported, nonBilledCost: nonBilled };
}

function ioOf(attributes: NormalizedAttributes): SpanIO {
  const input = pickIOText(
    attributes,
    EXPLICIT_INPUT_KEYS,
    FALLBACK_INPUT_KEYS,
  );
  const output = pickIOText(
    attributes,
    EXPLICIT_OUTPUT_KEYS,
    FALLBACK_OUTPUT_KEYS,
  );
  return {
    inputText: input.text,
    inputIsExplicit: input.isExplicit,
    outputText: output.text,
    outputIsExplicit: output.isExplicit,
  };
}

function pickIOText(
  attributes: NormalizedAttributes,
  explicitKeys: readonly string[],
  fallbackKeys: readonly string[],
): { text: string | null; isExplicit: boolean } {
  for (const key of explicitKeys) {
    const text = ioText(attributes[key]);
    if (text !== null) return { text, isExplicit: true };
  }
  for (const key of fallbackKeys) {
    const text = ioText(attributes[key]);
    if (text !== null) return { text, isExplicit: false };
  }
  return { text: null, isExplicit: false };
}

/**
 * The SDKs wrap IO as `{ type, value }`; a string `value` is the text itself
 * and anything richer (chat messages, a structured object) is carried whole.
 */
function ioText(raw: unknown): string | null {
  if (typeof raw === "string") return nonEmpty(raw);
  if (raw === null || raw === undefined) return null;
  return isRecord(raw) && "value" in raw
    ? wrappedIOText(raw.value)
    : stringify(raw);
}

/** The envelope's payload: a string is the text, anything richer is carried whole. */
function wrappedIOText(value: unknown): string | null {
  if (typeof value === "string") return nonEmpty(value);
  if (value === null || value === undefined) return null;
  return stringify(value);
}

function nonEmpty(text: string): string | null {
  return text.length > 0 ? text : null;
}

/**
 * A duration attribute is already relative to the span start; a
 * `langwatch.timestamps` instant has to be turned into one, and is ignored
 * when it predates the span.
 */
function timeToFirstTokenOf({
  attributes,
  metrics,
  timestamps,
  startTimeUnixMs,
}: {
  attributes: NormalizedAttributes;
  metrics: MetricsBlob;
  timestamps: TimestampsBlob;
  startTimeUnixMs: number;
}): number | null {
  const reported = firstCount(attributes, [
    ATTR_KEYS.GEN_AI_SERVER_TIME_TO_FIRST_TOKEN,
    ATTR_KEYS.AI_RESPONSE_MS_TO_FIRST_CHUNK,
  ]);
  if (reported !== null && reported >= 0) return reported;
  if (metrics.firstTokenMs !== null && metrics.firstTokenMs >= 0) {
    return metrics.firstTokenMs;
  }
  return offsetFrom(timestamps.firstTokenAt, startTimeUnixMs);
}

function timeToLastTokenOf({
  timestamps,
  startTimeUnixMs,
}: {
  timestamps: TimestampsBlob;
  startTimeUnixMs: number;
}): number | null {
  return offsetFrom(timestamps.finishedAt, startTimeUnixMs);
}

function offsetFrom(
  instant: number | null,
  startTimeUnixMs: number,
): number | null {
  if (instant === null) return null;
  const offset = instant - startTimeUnixMs;
  return offset >= 0 ? offset : null;
}
