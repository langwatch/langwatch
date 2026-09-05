/**
 * The `stored_spans` row codec: how a normalized span becomes ClickHouse
 * columns and how those columns become a normalized span again.
 *
 * Extracted from `span-storage.clickhouse.repository.ts` in `platform/app`,
 * where it sat beside the repository that uses it and could therefore be
 * reached only from the application. Nothing here touches a client, a
 * connection or a query — it is a pure mapping over row shapes — so it belongs
 * next to the trace contract it maps onto rather than behind a repository.
 *
 * The immediate reason it moved: `@langwatch/coding-agent-server`'s span-facts
 * redelivery test needs `mapChRowToNormalized` and `serializeAttributes`, and
 * was importing them through `~/server/app-layer/...` — the APP's path alias,
 * from inside a package, which resolves to nothing and left the whole file
 * uncompilable.
 *
 * The WRITE record types (`ClickHouseSpanRecord`,
 * `ClickHouseSpanWriteRecord`) deliberately stayed behind: they are shaped by
 * the application's `WithDateWrites`, which is a property of how that
 * repository writes rather than of the row itself.
 */
import { createLogger } from "@langwatch/observability";
import { NormalizedSpanKind, NormalizedStatusCode } from "@langwatch/trace-contract";

const DECIMAL_NUMBER_RE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

const logger = createLogger("langwatch:trace:stored-span-row-codec");

/** A ClickHouse Nullable(Float) as a number, or null when it is absent or unparseable. */
function nullableFloat(raw: number | string | null | undefined): number | null {
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

function validateStatusCode(value: number | null): NormalizedStatusCode | null {
  if (value === null) return null;
  if (VALID_STATUS_CODES.has(value)) return value as NormalizedStatusCode;
  logger.warn({ value }, "Unknown StatusCode from ClickHouse, defaulting to UNSET");
  return NormalizedStatusCode.UNSET;
}

/**
 * Ensures a ClickHouse Map(String, String) value is actually Record<string, string>.
 * Non-string values are dropped with a warning.
 *
 * Exported so every stored_spans read path shares the same row decoding.
 * Pair with {@link deserializeAttributes}.
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

/**
 * Deserializes attribute values read from ClickHouse Map(String, String) columns.
 * Reverses serializeAttributes: parses JSON strings back to objects/arrays,
 * converts "true"/"false" to booleans, and numeric strings to numbers.
 *
 * @internal Exported for unit testing
 */
export function deserializeAttributes(attrs: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    // Boolean strings
    if (value === "true") {
      result[key] = true;
      continue;
    }
    if (value === "false") {
      result[key] = false;
      continue;
    }

    // JSON objects and arrays
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        result[key] = JSON.parse(trimmed);
        continue;
      } catch {
        // Not valid JSON, fall through
      }
    }

    // NOTE: Intentionally lossy for string values that look like decimal numbers
    // (e.g. zip codes "90210" → 90210). ClickHouse round-trip for originally-numeric
    // attributes is correct; pure string numerics may lose their string type.
    // Guard: skip conversion for integers beyond Number.MAX_SAFE_INTEGER to avoid precision loss.
    if (trimmed !== "" && DECIMAL_NUMBER_RE.test(trimmed) && Number.isFinite(Number(trimmed))) {
      const num = Number(trimmed);
      if (Number.isInteger(num) && Math.abs(num) > Number.MAX_SAFE_INTEGER) {
        result[key] = value;
        continue;
      }
      result[key] = num;
      continue;
    }

    // Keep as string
    result[key] = value;
  }
  return result;
}

/**
 * Serializes attribute values for ClickHouse Map(String, String) columns.
 * Non-scalar values are JSON-stringified at the write boundary.
 *
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
      }
    }
  }
  return result;
}

/**
 * The projection of `stored_spans` that {@link mapChRowToNormalized} reads.
 * Exported so the claim-check equivalence test can drive the REAL mapping
 * rather than a hand-built stand-in — the whole claim-check design rests on a
 * resolved span producing the same command as the inline one, and a
 * column-mapping regression is exactly what that contract must catch.
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

export function mapChRowToNormalized(row: FullSpanRow) {
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
    statusCode: validateStatusCode(row.StatusCode),
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
    cost: nullableFloat(row.Cost),
    nonBilledCost: nullableFloat(row.NonBilledCost),
  };
}
