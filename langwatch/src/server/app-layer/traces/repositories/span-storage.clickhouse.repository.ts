import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { WithDateWrites } from "~/server/clickhouse/types";
import {
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import type { ElasticSearchEvent, Span } from "~/server/tracer/types";
import { mapNormalizedSpansToSpans } from "~/server/traces/mappers/span.mapper";
import { createLogger } from "~/utils/logger/server";
import type { SpanInsertData } from "../types";
import type {
  LangwatchSignalBucket,
  OccurredAtHint,
  SpanLangwatchSignalsRow,
  SpanResourceInfo,
  SpanStorageRepository,
  SpanSummaryRow,
} from "./span-storage.repository";
import { LANGWATCH_SIGNAL_BUCKETS } from "./span-storage.repository";

const TABLE_NAME = "stored_spans" as const;

/**
 * `stored_spans` is partitioned by `toYearWeek(StartTime)`. When the caller
 * passes an approximate trace timestamp we narrow the scan to a ±2-day
 * window around it — this keeps drawer reads on the warm partition tier
 * instead of walking every weekly partition (incl. cold S3) on every query.
 *
 * Generous on purpose: long-running traces and clock skew should still hit
 * the hinted window. If they don't, callers retry without the hint.
 */
const PARTITION_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

interface PartitionWindow {
  fromMs: number;
  toMs: number;
}

interface PartitionFragment {
  sqlAnd: string;
  sqlAndInner: string;
  params: Record<string, unknown>;
}

function partitionWindowFor(
  hint: OccurredAtHint | undefined,
): PartitionWindow | undefined {
  if (hint?.occurredAtMs === undefined) return undefined;
  return {
    fromMs: hint.occurredAtMs - PARTITION_WINDOW_MS,
    toMs: hint.occurredAtMs + PARTITION_WINDOW_MS,
  };
}

function partitionFragment(
  window: PartitionWindow | undefined,
): PartitionFragment {
  if (!window) {
    return { sqlAnd: "", sqlAndInner: "", params: {} };
  }
  return {
    sqlAnd:
      "AND StartTime >= fromUnixTimestamp64Milli({fromMs:Int64}) " +
      "AND StartTime <= fromUnixTimestamp64Milli({toMs:Int64})",
    sqlAndInner:
      "AND StartTime >= fromUnixTimestamp64Milli({fromMs:Int64}) " +
      "AND StartTime <= fromUnixTimestamp64Milli({toMs:Int64})",
    params: { fromMs: window.fromMs, toMs: window.toMs },
  };
}

/**
 * Run a hinted query first; if the hint window misses (e.g. long-running
 * trace, stale URL hint, clock skew), fall back to an unconstrained scan.
 * Avoids the slow path on the happy path while keeping correctness when
 * hints are wrong.
 */
async function withPartitionHint<T>(
  hint: OccurredAtHint | undefined,
  isEmpty: (result: T) => boolean,
  run: (window: PartitionWindow | undefined) => Promise<T>,
): Promise<T> {
  const window = partitionWindowFor(hint);
  if (!window) return run(undefined);
  const hinted = await run(window);
  if (!isEmpty(hinted)) return hinted;
  return run(undefined);
}

/**
 * Full-span column projection used by every reader that returns `Span[]`.
 * Defined once so a column rename in `stored_spans` lands in one place.
 *
 * Heavy columns (`SpanAttributes`, `Events.*` arrays, `Links.*` arrays) are
 * intentional — they're what callers need. Trim only when adding a new
 * reader that doesn't need them.
 */
const FULL_SPAN_SELECT = `
  SpanId,
  TraceId,
  TenantId,
  ParentSpanId,
  ParentTraceId,
  ParentIsRemote,
  Sampled,
  toUnixTimestamp64Milli(StartTime) AS StartTimeMs,
  toUnixTimestamp64Milli(EndTime) AS EndTimeMs,
  DurationMs,
  SpanName,
  SpanKind,
  ResourceAttributes,
  SpanAttributes,
  StatusCode,
  StatusMessage,
  ScopeName,
  ScopeVersion,
  arrayMap(x -> toUnixTimestamp64Milli(x), \`Events.Timestamp\`) AS Events_Timestamp,
  \`Events.Name\` AS Events_Name,
  \`Events.Attributes\` AS Events_Attributes,
  \`Links.TraceId\` AS Links_TraceId,
  \`Links.SpanId\` AS Links_SpanId,
  \`Links.Attributes\` AS Links_Attributes
`;

/**
 * Light projection used by readers that only need the span tree shape
 * (waterfall/flame, span list). Avoids reading heavy `SpanAttributes`,
 * `Events.*`, and `Links.*` columns. Map subscripts (`['key']`) read a
 * single value out of the Map without materializing the whole column.
 */
const SUMMARY_SPAN_SELECT = `
  SpanId,
  ParentSpanId,
  SpanName,
  DurationMs,
  StatusCode,
  SpanAttributes['langwatch.span.type'] AS SpanType,
  SpanAttributes['gen_ai.request.model'] AS Model,
  toUnixTimestamp64Milli(StartTime) AS StartTimeMs
`;

/**
 * IN-tuple dedup subquery body. Renders the inner `SELECT … GROUP BY` that
 * picks the latest version (max UpdatedAt) per spanId. Caller assembles the
 * surrounding `AND (TenantId, TraceId, SpanId, UpdatedAt) IN (…)`.
 *
 * Kept as a function so optional extra predicates (partition window,
 * sinceStartTimeMs) are applied symmetrically in inner + outer scopes —
 * essential because the dedup must see the same row set as the outer scan.
 */
function dedupInTuple(extraInnerWhere: string): string {
  return `(TenantId, TraceId, SpanId, UpdatedAt) IN (
    SELECT TenantId, TraceId, SpanId, max(UpdatedAt)
    FROM ${TABLE_NAME}
    WHERE TenantId = {tenantId:String}
      AND TraceId = {traceId:String}
      ${extraInnerWhere}
    GROUP BY TenantId, TraceId, SpanId
  )`;
}

/**
 * Per-bucket key matchers for the LangWatch signals projection. Each entry
 * compiles to one ClickHouse boolean expression over `mapKeys(SpanAttributes)`.
 * Order must match `LANGWATCH_SIGNAL_BUCKETS` in span-storage.repository.ts —
 * we depend on the bucket name list to deserialize back into typed values.
 */
const SIGNAL_BUCKET_PREDICATES: Record<LangwatchSignalBucket, string> = {
  prompt: "arrayExists(k -> startsWith(k, 'langwatch.prompt.'), keys)",
  scenario:
    "arrayExists(k -> startsWith(k, 'langwatch.scenario.') OR k = 'scenario.run_id', keys)",
  user: "arrayExists(k -> k = 'langwatch.user_id' OR startsWith(k, 'langwatch.user.'), keys)",
  thread:
    "arrayExists(k -> k = 'gen_ai.conversation.id' OR k = 'langgraph.thread_id' OR startsWith(k, 'langwatch.thread.'), keys)",
  evaluation:
    "arrayExists(k -> startsWith(k, 'langwatch.evaluation'), keys)",
  rag: "arrayExists(k -> startsWith(k, 'langwatch.rag.'), keys)",
  metadata: "arrayExists(k -> startsWith(k, 'langwatch.metadata.'), keys)",
  genai: "arrayExists(k -> startsWith(k, 'gen_ai.'), keys)",
};

interface SpanSummaryQueryRow {
  SpanId: string;
  ParentSpanId: string | null;
  SpanName: string;
  DurationMs: number;
  StatusCode: number | null;
  SpanType: string;
  Model: string;
  StartTimeMs: number;
}

function mapSpanSummaryRow(row: SpanSummaryQueryRow): SpanSummaryRow {
  return {
    spanId: row.SpanId,
    parentSpanId: row.ParentSpanId,
    spanName: row.SpanName,
    durationMs: Number(row.DurationMs),
    statusCode: row.StatusCode,
    spanType: row.SpanType || null,
    model: row.Model || null,
    startTimeMs: Number(row.StartTimeMs),
  };
}

interface EventRow {
  event_id: string;
  trace_id: string;
  project_id: string;
  started_at: string | number;
  event_type: string;
  attributes: Record<string, string>;
}

function mapEventRow(row: EventRow): ElasticSearchEvent {
  const startedAt =
    typeof row.started_at === "string"
      ? parseInt(row.started_at, 10)
      : row.started_at;

  const metrics: Array<{ key: string; value: number }> = [];
  const eventDetails: Array<{ key: string; value: string }> = [];

  for (const [key, value] of Object.entries(row.attributes)) {
    const isMetricKey =
      key === "vote" ||
      key === "score" ||
      key.startsWith("metrics.") ||
      key.startsWith("event.metrics.");
    if (isMetricKey) {
      const metricKey = key.replace(/^(event\.)?metrics\./, "");
      metrics.push({ key: metricKey, value: parseFloat(value) || 0 });
    } else {
      eventDetails.push({ key, value });
    }
  }

  return {
    event_id: row.event_id,
    event_type: row.event_type,
    project_id: row.project_id,
    trace_id: row.trace_id,
    timestamps: {
      started_at: startedAt,
      inserted_at: startedAt,
      updated_at: startedAt,
    },
    metrics,
    event_details: eventDetails,
  };
}

/**
 * Matches strings that look like decimal numbers (including scientific notation).
 * Rejects hex (0x), octal (0o), and binary (0b) literals that Number() silently accepts.
 */
const DECIMAL_NUMBER_RE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

const logger = createLogger(
  "langwatch:app-layer:traces:span-storage-repository",
);

const VALID_SPAN_KINDS = new Set(
  Object.values(NormalizedSpanKind).filter(
    (v): v is number => typeof v === "number",
  ),
);
const VALID_STATUS_CODES = new Set(
  Object.values(NormalizedStatusCode).filter(
    (v): v is number => typeof v === "number",
  ),
);

function validateSpanKind(value: number): NormalizedSpanKind {
  if (VALID_SPAN_KINDS.has(value)) return value as NormalizedSpanKind;
  logger.warn(
    { value },
    "Unknown SpanKind from ClickHouse, defaulting to INTERNAL",
  );
  return NormalizedSpanKind.INTERNAL;
}

function validateStatusCode(value: number | null): NormalizedStatusCode | null {
  if (value === null) return null;
  if (VALID_STATUS_CODES.has(value)) return value as NormalizedStatusCode;
  logger.warn(
    { value },
    "Unknown StatusCode from ClickHouse, defaulting to UNSET",
  );
  return NormalizedStatusCode.UNSET;
}

/**
 * Ensures a ClickHouse Map(String, String) value is actually Record<string, string>.
 * Non-string values are dropped with a warning.
 */
function ensureStringRecord(
  raw: Record<string, unknown>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      result[key] = value;
    } else {
      logger.warn(
        { key, type: typeof value },
        "Non-string attribute value from ClickHouse",
      );
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
export function deserializeAttributes(
  attrs: Record<string, string>,
): Record<string, unknown> {
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
    if (
      trimmed !== "" &&
      DECIMAL_NUMBER_RE.test(trimmed) &&
      Number.isFinite(Number(trimmed))
    ) {
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
export function serializeAttributes(
  attrs: Record<string, unknown>,
): Record<string, string> {
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

type ClickHouseSpanWriteRecord = WithDateWrites<
  ClickHouseSpanRecord,
  "StartTime" | "EndTime" | "Events.Timestamp" | "CreatedAt" | "UpdatedAt"
>;

interface ClickHouseSpanRecord {
  ProjectionId: string;
  TenantId: string;
  TraceId: string;
  SpanId: string;
  ParentSpanId: string | null;
  ParentTraceId: string | null;
  ParentIsRemote: boolean | null;
  Sampled: boolean;
  StartTime: number;
  EndTime: number;
  DurationMs: number;
  SpanName: string;
  SpanKind: number;
  ServiceName: string;
  ResourceAttributes: Record<string, string>;
  SpanAttributes: Record<string, string>;
  StatusCode: number | null;
  StatusMessage: string | null;
  ScopeName: string;
  ScopeVersion: string | null;
  "Events.Timestamp": number[];
  "Events.Name": string[];
  "Events.Attributes": Record<string, string>[];
  "Links.TraceId": string[];
  "Links.SpanId": string[];
  "Links.Attributes": Record<string, string>[];
  DroppedAttributesCount: 0;
  DroppedEventsCount: 0;
  DroppedLinksCount: 0;
  CreatedAt: number;
  UpdatedAt: number;
}

interface FullSpanRow {
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
  Events_Timestamp: number[];
  Events_Name: string[];
  Events_Attributes: Record<string, unknown>[];
  Links_TraceId: string[];
  Links_SpanId: string[];
  Links_Attributes: Record<string, unknown>[];
}

function mapChRowToNormalized(row: FullSpanRow) {
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
    resourceAttributes: deserializeAttributes(
      ensureStringRecord(row.ResourceAttributes),
    ),
    spanAttributes: deserializeAttributes(
      ensureStringRecord(row.SpanAttributes),
    ),
    statusCode: validateStatusCode(row.StatusCode),
    statusMessage: row.StatusMessage,
    instrumentationScope: {
      name: row.ScopeName ?? "",
      version: row.ScopeVersion,
    },
    events: (row.Events_Timestamp ?? []).map((ts, i) => ({
      name: row.Events_Name?.[i] ?? "",
      timeUnixMs: ts,
      attributes: deserializeAttributes(
        ensureStringRecord(row.Events_Attributes?.[i] ?? {}),
      ),
    })),
    links: (row.Links_TraceId ?? []).map((lt, i) => ({
      traceId: lt,
      spanId: row.Links_SpanId?.[i] ?? "",
      attributes: deserializeAttributes(
        ensureStringRecord(row.Links_Attributes?.[i] ?? {}),
      ),
    })),
    droppedAttributesCount: 0 as const,
    droppedEventsCount: 0 as const,
    droppedLinksCount: 0 as const,
  };
}

export class SpanStorageClickHouseRepository implements SpanStorageRepository {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async insertSpan(span: SpanInsertData): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: span.tenantId },
      "SpanStorageClickHouseRepository.insertSpan",
    );

    try {
      const client = await this.resolveClient(span.tenantId);
      const record = this.toClickHouseRecord(span);
      await client.insert({
        table: TABLE_NAME,
        values: [record],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.error(
        {
          tenantId: span.tenantId,
          spanId: span.spanId,
          traceId: span.traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to insert span into ClickHouse",
      );
      throw error;
    }
  }

  async insertSpans(spans: SpanInsertData[]): Promise<void> {
    if (spans.length === 0) return;

    for (const span of spans) {
      EventUtils.validateTenantId(
        { tenantId: span.tenantId },
        "SpanStorageClickHouseRepository.insertSpans",
      );
    }

    // Enforce that a single bulk insert only writes spans for one tenant —
    // the client is resolved once from the first span's tenantId, so mixed
    // batches would silently route another tenant's data through the wrong
    // (possibly private) ClickHouse instance.
    const tenantId = spans[0]!.tenantId;
    for (const span of spans) {
      if (span.tenantId !== tenantId) {
        throw new SecurityError(
          "SpanStorageClickHouseRepository.insertSpans",
          "all spans in a single batch must share the same tenantId",
          tenantId,
          { mismatchedTenantId: span.tenantId },
        );
      }
    }

    try {
      const client = await this.resolveClient(tenantId);
      const records = spans.map((span) => this.toClickHouseRecord(span));
      await client.insert({
        table: TABLE_NAME,
        values: records,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.error(
        {
          count: spans.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to bulk insert spans into ClickHouse",
      );
      throw error;
    }
  }

  async getSpansByTraceId({
    tenantId,
    traceId,
    occurredAtMs,
  }: {
    tenantId: string;
    traceId: string;
  } & OccurredAtHint): Promise<Span[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "SpanStorageClickHouseRepository.getSpansByTraceId",
    );

    try {
      return await withPartitionHint<Span[]>(
        { occurredAtMs },
        (rows) => rows.length === 0,
        async (window) => {
          const partition = partitionFragment(window);
          const client = await this.resolveClient(tenantId);
          const result = await client.query({
            query: `
              SELECT ${FULL_SPAN_SELECT}
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
                AND TraceId = {traceId:String}
                ${partition.sqlAnd}
                AND ${dedupInTuple(partition.sqlAndInner)}
              ORDER BY StartTimeMs ASC
            `,
            query_params: { tenantId, traceId, ...partition.params },
            format: "JSONEachRow",
          });

          const rows = (await result.json()) as FullSpanRow[];
          return mapNormalizedSpansToSpans(rows.map(mapChRowToNormalized));
        },
      );
    } catch (error) {
      logger.error(
        {
          tenantId,
          traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to get spans by trace ID from ClickHouse",
      );
      throw error;
    }
  }

  async getSpanByIds({
    tenantId,
    traceId,
    spanId,
    occurredAtMs,
  }: {
    tenantId: string;
    traceId: string;
    spanId: string;
  } & OccurredAtHint): Promise<Span | null> {
    EventUtils.validateTenantId(
      { tenantId },
      "SpanStorageClickHouseRepository.getSpanByIds",
    );

    try {
      return await withPartitionHint<Span | null>(
        { occurredAtMs },
        (span) => span === null,
        async (window) => {
          const partition = partitionFragment(window);
          const client = await this.resolveClient(tenantId);
          // Single-span fetch: WHERE pins (TenantId, TraceId, SpanId) — the
          // primary key prefix — so we hit a tiny granule range. With at most
          // a handful of versions per spanId, ORDER BY UpdatedAt DESC LIMIT 1
          // is cheaper than the IN-tuple dedup the multi-row paths need.
          const result = await client.query({
            query: `
              SELECT ${FULL_SPAN_SELECT}
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
                AND TraceId = {traceId:String}
                AND SpanId = {spanId:String}
                ${partition.sqlAnd}
              ORDER BY UpdatedAt DESC
              LIMIT 1
            `,
            query_params: { tenantId, traceId, spanId, ...partition.params },
            format: "JSONEachRow",
          });

          const rows = (await result.json()) as FullSpanRow[];
          if (rows.length === 0) return null;
          const [span] = mapNormalizedSpansToSpans(
            rows.map(mapChRowToNormalized),
          );
          return span ?? null;
        },
      );
    } catch (error) {
      logger.error(
        {
          tenantId,
          traceId,
          spanId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to get span by ids from ClickHouse",
      );
      throw error;
    }
  }

  async findSpanResourcesByTraceId({
    tenantId,
    traceId,
    occurredAtMs,
  }: {
    tenantId: string;
    traceId: string;
  } & OccurredAtHint): Promise<SpanResourceInfo[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "SpanStorageClickHouseRepository.findSpanResourcesByTraceId",
    );

    return withPartitionHint<SpanResourceInfo[]>(
      { occurredAtMs },
      (rows) => rows.length === 0,
      async (window) => {
        const partition = partitionFragment(window);
        const client = await this.resolveClient(tenantId);
        // Light projection: only the resource/scope columns plus the bits
        // needed for ordering. SpanAttributes/Events/Links are heavy and
        // unrelated to OTel resource info, so don't read them.
        const result = await client.query({
          query: `
            SELECT
              SpanId,
              ParentSpanId,
              toUnixTimestamp64Milli(StartTime) AS StartTimeMs,
              ResourceAttributes,
              ScopeName,
              ScopeVersion
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND TraceId = {traceId:String}
              ${partition.sqlAnd}
              AND ${dedupInTuple(partition.sqlAndInner)}
            ORDER BY StartTimeMs ASC
          `,
          query_params: { tenantId, traceId, ...partition.params },
          format: "JSONEachRow",
        });

        const rows = (await result.json()) as Array<{
          SpanId: string;
          ParentSpanId: string | null;
          StartTimeMs: number;
          ResourceAttributes: Record<string, string>;
          ScopeName: string | null;
          ScopeVersion: string | null;
        }>;

        return rows.map((row) => ({
          spanId: row.SpanId,
          parentSpanId: row.ParentSpanId,
          startTimeMs: row.StartTimeMs,
          resourceAttributes: ensureStringRecord(row.ResourceAttributes),
          scopeName: row.ScopeName ?? null,
          scopeVersion: row.ScopeVersion ?? null,
        }));
      },
    );
  }

  async getEventsByTraceId({
    tenantId,
    traceId,
    occurredAtMs,
  }: {
    tenantId: string;
    traceId: string;
  } & OccurredAtHint): Promise<ElasticSearchEvent[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "SpanStorageClickHouseRepository.getEventsByTraceId",
    );

    try {
      return await withPartitionHint<ElasticSearchEvent[]>(
        { occurredAtMs },
        (rows) => rows.length === 0,
        async (window) => {
          const partition = partitionFragment(window);
          const client = await this.resolveClient(tenantId);
          const result = await client.query({
            query: `
              SELECT
                SpanId AS event_id,
                TraceId AS trace_id,
                TenantId AS project_id,
                toUnixTimestamp64Milli(event_timestamp) AS started_at,
                event_name AS event_type,
                event_attrs AS attributes
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
                AND TraceId = {traceId:String}
                ${partition.sqlAnd}
                AND ${dedupInTuple(partition.sqlAndInner)}
              ARRAY JOIN
                "Events.Timestamp" AS event_timestamp,
                "Events.Name" AS event_name,
                "Events.Attributes" AS event_attrs
              WHERE event_name != 'exception'
              ORDER BY event_timestamp DESC
            `,
            query_params: { tenantId, traceId, ...partition.params },
            format: "JSONEachRow",
          });

          const rows = (await result.json()) as EventRow[];
          return rows.map(mapEventRow);
        },
      );
    } catch (error) {
      logger.error(
        {
          tenantId,
          traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to get events by trace ID from ClickHouse",
      );
      throw error;
    }
  }

  async getSpanEvents({
    tenantId,
    traceId,
    spanId,
    occurredAtMs,
  }: {
    tenantId: string;
    traceId: string;
    spanId: string;
  } & OccurredAtHint): Promise<ElasticSearchEvent[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "SpanStorageClickHouseRepository.getSpanEvents",
    );

    try {
      return await withPartitionHint<ElasticSearchEvent[]>(
        { occurredAtMs },
        (rows) => rows.length === 0,
        async (window) => {
          const partition = partitionFragment(window);
          const client = await this.resolveClient(tenantId);
          const result = await client.query({
            query: `
              SELECT
                SpanId AS event_id,
                TraceId AS trace_id,
                TenantId AS project_id,
                toUnixTimestamp64Milli(event_timestamp) AS started_at,
                event_name AS event_type,
                event_attrs AS attributes
              FROM (
                SELECT
                  TenantId, TraceId, SpanId,
                  "Events.Timestamp" AS Events_Timestamp,
                  "Events.Name" AS Events_Name,
                  "Events.Attributes" AS Events_Attributes
                FROM ${TABLE_NAME}
                WHERE TenantId = {tenantId:String}
                  AND TraceId = {traceId:String}
                  AND SpanId = {spanId:String}
                  ${partition.sqlAnd}
                ORDER BY UpdatedAt DESC
                LIMIT 1
              )
              ARRAY JOIN
                Events_Timestamp AS event_timestamp,
                Events_Name AS event_name,
                Events_Attributes AS event_attrs
              ORDER BY event_timestamp DESC
            `,
            query_params: { tenantId, traceId, spanId, ...partition.params },
            format: "JSONEachRow",
          });

          const rows = (await result.json()) as EventRow[];
          return rows.map(mapEventRow);
        },
      );
    } catch (error) {
      logger.error(
        {
          tenantId,
          traceId,
          spanId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to get events by span ID from ClickHouse",
      );
      throw error;
    }
  }

  async getSpanSummaryByTraceId({
    tenantId,
    traceId,
    occurredAtMs,
  }: {
    tenantId: string;
    traceId: string;
  } & OccurredAtHint): Promise<SpanSummaryRow[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "SpanStorageClickHouseRepository.getSpanSummaryByTraceId",
    );

    return withPartitionHint<SpanSummaryRow[]>(
      { occurredAtMs },
      (rows) => rows.length === 0,
      async (window) => {
        const partition = partitionFragment(window);
        const client = await this.resolveClient(tenantId);
        const result = await client.query({
          query: `
            SELECT ${SUMMARY_SPAN_SELECT}
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND TraceId = {traceId:String}
              ${partition.sqlAnd}
              AND ${dedupInTuple(partition.sqlAndInner)}
            ORDER BY StartTimeMs ASC
          `,
          query_params: { tenantId, traceId, ...partition.params },
          format: "JSONEachRow",
        });

        const rows = await result.json<SpanSummaryQueryRow>();
        return rows.map(mapSpanSummaryRow);
      },
    );
  }

  async findLangwatchSignalsByTraceId({
    tenantId,
    traceId,
    occurredAtMs,
  }: {
    tenantId: string;
    traceId: string;
  } & OccurredAtHint): Promise<SpanLangwatchSignalsRow[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "SpanStorageClickHouseRepository.findLangwatchSignalsByTraceId",
    );

    return withPartitionHint<SpanLangwatchSignalsRow[]>(
      { occurredAtMs },
      (rows) => rows.length === 0,
      async (window) => {
        const partition = partitionFragment(window);
        const client = await this.resolveClient(tenantId);
        // Reads `mapKeys(SpanAttributes)` once per row into a CTE-style
        // alias (`keys`) so each bucket predicate doesn't re-materialize
        // the key array. Heavy attribute *values* are never read — only
        // their keys — keeping this scan an order of magnitude lighter
        // than getSpansByTraceId.
        const result = await client.query({
          query: `
            SELECT
              SpanId,
              arrayFilter(x -> x != '', [
                ${LANGWATCH_SIGNAL_BUCKETS.map(
                  (bucket) =>
                    `if(${SIGNAL_BUCKET_PREDICATES[bucket]}, '${bucket}', '')`,
                ).join(",\n                ")}
              ]) AS Signals
            FROM (
              SELECT
                SpanId,
                mapKeys(SpanAttributes) AS keys
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
                AND TraceId = {traceId:String}
                ${partition.sqlAnd}
                AND ${dedupInTuple(partition.sqlAndInner)}
            )
          `,
          query_params: { tenantId, traceId, ...partition.params },
          format: "JSONEachRow",
        });

        const rows = (await result.json()) as Array<{
          SpanId: string;
          Signals: string[];
        }>;

        const validBuckets = new Set<string>(LANGWATCH_SIGNAL_BUCKETS);
        return rows
          .filter((r) => Array.isArray(r.Signals) && r.Signals.length > 0)
          .map((r) => ({
            spanId: r.SpanId,
            signals: r.Signals.filter((s): s is LangwatchSignalBucket =>
              validBuckets.has(s),
            ),
          }))
          .filter((r) => r.signals.length > 0);
      },
    );
  }

  async findSpansPaginated({
    tenantId,
    traceId,
    limit,
    offset,
    occurredAtMs,
  }: {
    tenantId: string;
    traceId: string;
    limit: number;
    offset: number;
  } & OccurredAtHint): Promise<{ spans: Span[]; total: number }> {
    EventUtils.validateTenantId(
      { tenantId },
      "SpanStorageClickHouseRepository.findSpansPaginated",
    );

    return withPartitionHint<{ spans: Span[]; total: number }>(
      { occurredAtMs },
      (result) => result.spans.length === 0,
      async (window) => {
        const partition = partitionFragment(window);
        const client = await this.resolveClient(tenantId);
        // Two-step instead of one query with `count() OVER ()`:
        //   - Page query reads the heavy span columns for LIMIT rows only.
        //   - Count query touches just the dedup keys, no heavy payload.
        // Window-counting in a single query forces ClickHouse to materialize
        // every span in the trace (incl. SpanAttributes, Events.*, Links.*)
        // — fine for tiny traces, ruinous for the long ones. Parallel two
        // queries scan the same partitions but don't pay for heavy columns
        // on the count side.
        const [pageResult, countResult] = await Promise.all([
          client.query({
            query: `
              SELECT ${FULL_SPAN_SELECT}
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
                AND TraceId = {traceId:String}
                ${partition.sqlAnd}
                AND ${dedupInTuple(partition.sqlAndInner)}
              ORDER BY StartTime ASC
              LIMIT {limit:UInt32}
              OFFSET {offset:UInt32}
            `,
            query_params: {
              tenantId,
              traceId,
              limit,
              offset,
              ...partition.params,
            },
            format: "JSONEachRow",
          }),
          client.query({
            query: `
              SELECT count(DISTINCT SpanId) AS Total
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
                AND TraceId = {traceId:String}
                ${partition.sqlAnd}
            `,
            query_params: { tenantId, traceId, ...partition.params },
            format: "JSONEachRow",
          }),
        ]);

        const pageRows = (await pageResult.json()) as FullSpanRow[];
        const countRows = (await countResult.json()) as Array<{
          Total: number | string;
        }>;
        const total = countRows.length > 0 ? Number(countRows[0]!.Total) : 0;

        return {
          spans: mapNormalizedSpansToSpans(pageRows.map(mapChRowToNormalized)),
          total,
        };
      },
    );
  }

  async findSpansSince({
    tenantId,
    traceId,
    sinceStartTimeMs,
    occurredAtMs,
  }: {
    tenantId: string;
    traceId: string;
    sinceStartTimeMs: number;
  } & OccurredAtHint): Promise<Span[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "SpanStorageClickHouseRepository.findSpansSince",
    );

    return withPartitionHint<Span[]>(
      { occurredAtMs },
      (rows) => rows.length === 0,
      async (window) => {
        const partition = partitionFragment(window);
        const sinceFilter =
          "AND StartTime > fromUnixTimestamp64Milli({sinceStartTimeMs:Int64})";
        const innerExtra = `${sinceFilter} ${partition.sqlAndInner}`;
        const client = await this.resolveClient(tenantId);
        const result = await client.query({
          query: `
            SELECT ${FULL_SPAN_SELECT}
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND TraceId = {traceId:String}
              ${sinceFilter}
              ${partition.sqlAnd}
              AND ${dedupInTuple(innerExtra)}
            ORDER BY StartTime ASC
          `,
          query_params: {
            tenantId,
            traceId,
            sinceStartTimeMs,
            ...partition.params,
          },
          format: "JSONEachRow",
        });

        const rows = (await result.json()) as FullSpanRow[];
        return mapNormalizedSpansToSpans(rows.map(mapChRowToNormalized));
      },
    );
  }

  async findSpanSummariesPaginated({
    tenantId,
    traceId,
    limit,
    offset,
    occurredAtMs,
  }: {
    tenantId: string;
    traceId: string;
    limit: number;
    offset: number;
  } & OccurredAtHint): Promise<{ rows: SpanSummaryRow[]; total: number }> {
    EventUtils.validateTenantId(
      { tenantId },
      "SpanStorageClickHouseRepository.findSpanSummariesPaginated",
    );

    return withPartitionHint<{ rows: SpanSummaryRow[]; total: number }>(
      { occurredAtMs },
      (result) => result.rows.length === 0,
      async (window) => {
        const partition = partitionFragment(window);
        const client = await this.resolveClient(tenantId);
        // Same two-step rationale as findSpansPaginated, except the page
        // query is already light (summary columns only). Splitting still
        // helps because count() OVER () forces the deduped row set to be
        // materialized in full before the LIMIT — a wasted scan when the
        // user is on page N and we just want a number.
        const [pageResult, countResult] = await Promise.all([
          client.query({
            query: `
              SELECT ${SUMMARY_SPAN_SELECT}
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
                AND TraceId = {traceId:String}
                ${partition.sqlAnd}
                AND ${dedupInTuple(partition.sqlAndInner)}
              ORDER BY StartTime ASC
              LIMIT {limit:UInt32}
              OFFSET {offset:UInt32}
            `,
            query_params: {
              tenantId,
              traceId,
              limit,
              offset,
              ...partition.params,
            },
            format: "JSONEachRow",
          }),
          client.query({
            query: `
              SELECT count(DISTINCT SpanId) AS Total
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
                AND TraceId = {traceId:String}
                ${partition.sqlAnd}
            `,
            query_params: { tenantId, traceId, ...partition.params },
            format: "JSONEachRow",
          }),
        ]);

        const pageRows = await pageResult.json<SpanSummaryQueryRow>();
        const countRows = (await countResult.json()) as Array<{
          Total: number | string;
        }>;
        const total = countRows.length > 0 ? Number(countRows[0]!.Total) : 0;

        return {
          rows: pageRows.map(mapSpanSummaryRow),
          total,
        };
      },
    );
  }

  async findSpanSummariesSince({
    tenantId,
    traceId,
    sinceStartTimeMs,
    occurredAtMs,
  }: {
    tenantId: string;
    traceId: string;
    sinceStartTimeMs: number;
  } & OccurredAtHint): Promise<SpanSummaryRow[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "SpanStorageClickHouseRepository.findSpanSummariesSince",
    );

    return withPartitionHint<SpanSummaryRow[]>(
      { occurredAtMs },
      (rows) => rows.length === 0,
      async (window) => {
        const partition = partitionFragment(window);
        const sinceFilter =
          "AND StartTime > fromUnixTimestamp64Milli({sinceStartTimeMs:Int64})";
        const innerExtra = `${sinceFilter} ${partition.sqlAndInner}`;
        const client = await this.resolveClient(tenantId);
        const result = await client.query({
          query: `
            SELECT ${SUMMARY_SPAN_SELECT}
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND TraceId = {traceId:String}
              ${sinceFilter}
              ${partition.sqlAnd}
              AND ${dedupInTuple(innerExtra)}
            ORDER BY StartTimeMs ASC
          `,
          query_params: {
            tenantId,
            traceId,
            sinceStartTimeMs,
            ...partition.params,
          },
          format: "JSONEachRow",
        });

        const rows = await result.json<SpanSummaryQueryRow>();
        return rows.map(mapSpanSummaryRow);
      },
    );
  }

  private toClickHouseRecord(span: SpanInsertData): ClickHouseSpanWriteRecord {
    const serviceNameAny =
      span.spanAttributes["service.name"] ??
      span.resourceAttributes["service.name"];
    const serviceName =
      typeof serviceNameAny === "string" ? serviceNameAny : "unknown";

    return {
      ProjectionId: span.id,
      TenantId: span.tenantId,
      TraceId: span.traceId,
      SpanId: span.spanId,
      ParentSpanId: span.parentSpanId,
      ParentTraceId: span.parentTraceId,
      ParentIsRemote: span.parentIsRemote,
      Sampled: span.sampled,
      StartTime: new Date(span.startTimeUnixMs),
      EndTime: new Date(span.endTimeUnixMs),
      DurationMs: Math.round(span.durationMs),
      SpanName: span.name,
      SpanKind: span.kind,
      ServiceName: serviceName,
      ResourceAttributes: serializeAttributes(span.resourceAttributes),
      SpanAttributes: serializeAttributes(span.spanAttributes),
      StatusCode: span.statusCode,
      StatusMessage: span.statusMessage,
      ScopeName: span.instrumentationScope.name,
      ScopeVersion: span.instrumentationScope.version ?? null,
      "Events.Timestamp": span.events.map((e) => new Date(e.timeUnixMs)),
      "Events.Name": span.events.map((e) => e.name),
      "Events.Attributes": span.events.map((e) =>
        serializeAttributes(e.attributes),
      ),
      "Links.TraceId": span.links.map((l) => l.traceId),
      "Links.SpanId": span.links.map((l) => l.spanId),
      "Links.Attributes": span.links.map((l) =>
        serializeAttributes(l.attributes),
      ),
      DroppedAttributesCount: 0,
      DroppedEventsCount: 0,
      DroppedLinksCount: 0,
      CreatedAt: new Date(),
      UpdatedAt: new Date(),
    } satisfies ClickHouseSpanWriteRecord;
  }
}
