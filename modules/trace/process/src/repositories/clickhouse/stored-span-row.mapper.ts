/**
 * Stored_spans row codec: normalize span↔ClickHouse columns. Pure mapping,
 * moved here from app so coding-agent-server can import without path aliases.
 */
import { createLogger } from "@langwatch/observability";
import {
  NormalizedSpanKind,
  NormalizedStatusCode,
  type NormalizedSpan,
} from "@langwatch/trace-contract";

const DECIMAL_NUMBER_RE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

const logger = createLogger("langwatch:trace:stored-span-row-codec");

/** A ClickHouse Nullable(Float) as a number, or null when it is absent or unparseable. */
function toNullableFloat(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return Number.isFinite(n) ? n : null;
}

const VALID_SPAN_KINDS = new Set(
  Object.values(NormalizedSpanKind).filter((v): v is number => typeof v === "number"),
);
const VALID_STATUS_CODES = new Set(
  Object.values(NormalizedStatusCode).filter((v): v is number => typeof v === "number"),
);

function validateSpanKind(value: number): NormalizedSpanKind {
  if (VALID_SPAN_KINDS.has(value)) return value as NormalizedSpanKind;
  logger.warn({ value }, "Unknown SpanKind from ClickHouse, defaulting to INTERNAL");
  return NormalizedSpanKind.INTERNAL;
}

function normalizeStatusCode(value: number | null): NormalizedStatusCode | null {
  if (value === null) return null;
  if (VALID_STATUS_CODES.has(value)) return value as NormalizedStatusCode;
  logger.warn({ value }, "Unknown StatusCode from ClickHouse, defaulting to UNSET");
  return NormalizedStatusCode.UNSET;
}

/**
 * Ensures a ClickHouse Map(String, String) value is actually
 * Record<string, string>; non-string values are dropped with a warning.
 * Exported so every stored_spans read path shares the same row decoding.
 */
export function ensureStringRecord(raw: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      result[key] = value;
    } else {
      logger.warn({ key, type: typeof value }, "Non-string attribute value from ClickHouse");
    }
  }
  return result;
}

/** The parsed JSON value one attribute holds, or `undefined` when it is not JSON. */
function parseJsonAttribute(trimmed: string): unknown {
  const isJsonObject = trimmed.startsWith("{") && trimmed.endsWith("}");
  const isJsonArray = trimmed.startsWith("[") && trimmed.endsWith("]");
  if (!isJsonObject && !isJsonArray) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Not valid JSON, fall through
    return undefined;
  }
}

/**
 * Intentionally lossy for strings that look like decimal numbers (e.g. zip
 * "90210" → 90210); originally-numeric attributes round-trip correctly.
 * Integers beyond Number.MAX_SAFE_INTEGER stay strings to avoid precision loss.
 */
function parseNumericAttribute(trimmed: string): number | undefined {
  const isDecimalNumber =
    trimmed !== "" && DECIMAL_NUMBER_RE.test(trimmed) && Number.isFinite(Number(trimmed));
  if (!isDecimalNumber) {
    return undefined;
  }

  const num = Number(trimmed);
  const losesPrecision = Number.isInteger(num) && Math.abs(num) > Number.MAX_SAFE_INTEGER;

  return losesPrecision ? undefined : num;
}

/** One attribute value, read back as the type it was written from. */
function deserializeAttributeValue(value: string): unknown {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  const trimmed = value.trim();

  const json = parseJsonAttribute(trimmed);
  if (json !== undefined) {
    return json;
  }

  return parseNumericAttribute(trimmed) ?? value;
}

/**
 * Deserializes attribute values from ClickHouse Map(String, String) columns:
 * JSON strings to objects/arrays, "true"/"false" to booleans, numeric strings to numbers.
 * @internal Exported for unit testing
 */
export function deserializeAttributes(attrs: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    result[key] = deserializeAttributeValue(value);
  }

  return result;
}

/**
 * Serializes attribute values for ClickHouse Map(String, String) columns.
 * Non-scalar values are JSON-stringified at the write boundary.
 * @internal Exported for unit testing
 */
export function serializeAttributes(attrs: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string") {
      result[key] = value;
    } else if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint"
    ) {
      result[key] = String(value);
    } else {
      try {
        const serialized = JSON.stringify(value);
        if (typeof serialized === "string") {
          result[key] = serialized;
        }
      } catch {
        // skip unserializable attribute
        continue;
      }
    }
  }
  return result;
}

/**
 * The projection of `stored_spans` that {@link mapChRowToNormalized} reads.
 * Exported so the claim-check equivalence test drives the REAL mapping, not
 * a hand-built stand-in — exactly the column-mapping regression it must catch.
 */
export interface FullSpanRow {
  SpanId: string;
  TraceId: string;
  TenantId: string;
  ParentSpanId: string | null;
  ParentTraceId: string | null;
  ParentIsRemote: boolean | null;
  Sampled: boolean;
  StartTimeMs: number;
  EndTimeMs: number;
  DurationMs: number;
  SpanName: string;
  SpanKind: number;
  ResourceAttributes: Record<string, unknown>;
  SpanAttributes: Record<string, unknown>;
  StatusCode: number | null;
  StatusMessage: string | null;
  ScopeName: string | null;
  ScopeVersion: string | null;
  Cost: number | null;
  NonBilledCost: number | null;
  Events_Timestamp: number[];
  Events_Name: string[];
  Events_Attributes: Record<string, unknown>[];
  Links_TraceId: string[];
  Links_SpanId: string[];
  Links_Attributes: Record<string, unknown>[];
}

export function mapChRowToNormalized(row: FullSpanRow): NormalizedSpan {
  return {
    id: "",
    traceId: row.TraceId,
    spanId: row.SpanId,
    tenantId: row.TenantId,
    parentSpanId: row.ParentSpanId,
    parentTraceId: row.ParentTraceId,
    parentIsRemote: row.ParentIsRemote,
    sampled: row.Sampled,
    startTimeUnixMs: row.StartTimeMs,
    endTimeUnixMs: row.EndTimeMs,
    durationMs: row.DurationMs,
    name: row.SpanName,
    kind: validateSpanKind(row.SpanKind),
    resourceAttributes: deserializeAttributes(ensureStringRecord(row.ResourceAttributes)),
    spanAttributes: deserializeAttributes(ensureStringRecord(row.SpanAttributes)),
    statusCode: normalizeStatusCode(row.StatusCode),
    statusMessage: row.StatusMessage,
    instrumentationScope: {
      name: row.ScopeName ?? "",
      version: row.ScopeVersion,
    },
    events: (row.Events_Timestamp ?? []).map((ts, i) => ({
      name: row.Events_Name?.[i] ?? "",
      timeUnixMs: ts,
      attributes: deserializeAttributes(ensureStringRecord(row.Events_Attributes?.[i] ?? {})),
    })),
    links: (row.Links_TraceId ?? []).map((lt, i) => ({
      traceId: lt,
      spanId: row.Links_SpanId?.[i] ?? "",
      attributes: deserializeAttributes(ensureStringRecord(row.Links_Attributes?.[i] ?? {})),
    })),
    droppedAttributesCount: 0 as const,
    droppedEventsCount: 0 as const,
    droppedLinksCount: 0 as const,
    // Nullable(Float64) round-trips as number | null over JSONEachRow, but a
    // string can still arrive depending on settings — coerce defensively.
    cost: toNullableFloat(row.Cost),
    nonBilledCost: toNullableFloat(row.NonBilledCost),
  };
}
