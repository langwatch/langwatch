import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { WithDateWrites } from "~/server/clickhouse/types";
import { NormalizedSpanKind } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import { NormalizedStatusCode } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { mapNormalizedSpansToSpans } from "~/server/traces/mappers/span.mapper";
import type { ElasticSearchEvent, Span } from "~/server/tracer/types";
import { createLogger } from "~/utils/logger/server";
import type { SpanInsertData } from "../types";
import type { SpanStorageRepository } from "./span-storage.repository";

const TABLE_NAME = "stored_spans" as const;

/**
 * Matches strings that look like decimal numbers (including scientific notation).
 * Rejects hex (0x), octal (0o), and binary (0b) literals that Number() silently accepts.
 */
const DECIMAL_NUMBER_RE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

const logger = createLogger(
  "langwatch:app-layer:traces:span-storage-repository",
);

const VALID_SPAN_KINDS = new Set(Object.values(NormalizedSpanKind).filter((v): v is number => typeof v === "number"));
const VALID_STATUS_CODES = new Set(Object.values(NormalizedStatusCode).filter((v): v is number => typeof v === "number"));

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
 */
function ensureStringRecord(raw: Record<string, unknown>): Record<string, string> {
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
export function deserializeAttributes(
  attrs: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    // Boolean strings
    if (value === "true") { result[key] = true; continue; }
    if (value === "false") { result[key] = false; continue; }

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

    try {
      const records = spans.map((span) => this.toClickHouseRecord(span));
      await this.clickHouseClient.insert({
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

  async getSpansByTraceId({ tenantId, traceId }: { tenantId: string; traceId: string }): Promise<Span[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "SpanStorageClickHouseRepository.getSpansByTraceId",
    );

    try {
      const client = await this.resolveClient(tenantId);
      const result = await client.query({
        query: `
          SELECT
            SpanId,
            TraceId,
            TenantId,
            ParentSpanId,
            ParentTraceId,
            ParentIsRemote,
            Sampled,
            toUnixTimestamp64Milli(StartTime) AS StartTime,
            toUnixTimestamp64Milli(EndTime) AS EndTime,
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
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String}
            AND TraceId = {traceId:String}
            AND (TenantId, TraceId, SpanId, StartTime) IN (
              SELECT TenantId, TraceId, SpanId, max(StartTime)
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
                AND TraceId = {traceId:String}
              GROUP BY TenantId, TraceId, SpanId
            )
          ORDER BY StartTime ASC
        `,
        query_params: { tenantId, traceId },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<{
        SpanId: string;
        TraceId: string;
        TenantId: string;
        ParentSpanId: string | null;
        ParentTraceId: string | null;
        ParentIsRemote: boolean | null;
        Sampled: boolean;
        StartTime: number;
        EndTime: number;
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
      }>;

      // Re-use the existing mapper by converting CH rows to the SpanInsertData
      // shape expected by mapNormalizedSpansToSpans
      const normalizedSpans = rows.map((row) => ({
        id: "",
        traceId: row.TraceId,
        spanId: row.SpanId,
        tenantId: row.TenantId,
        parentSpanId: row.ParentSpanId,
        parentTraceId: row.ParentTraceId,
        parentIsRemote: row.ParentIsRemote,
        sampled: row.Sampled,
        startTimeUnixMs: row.StartTime,
        endTimeUnixMs: row.EndTime,
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
      }));

      return mapNormalizedSpansToSpans(normalizedSpans);
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

  async getEventsByTraceId({ tenantId, traceId }: { tenantId: string; traceId: string }): Promise<ElasticSearchEvent[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "SpanStorageClickHouseRepository.getEventsByTraceId",
    );

    try {
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
            AND (TenantId, TraceId, SpanId, StartTime) IN (
              SELECT TenantId, TraceId, SpanId, max(StartTime)
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
                AND TraceId = {traceId:String}
              GROUP BY TenantId, TraceId, SpanId
            )
          ARRAY JOIN
            "Events.Timestamp" AS event_timestamp,
            "Events.Name" AS event_name,
            "Events.Attributes" AS event_attrs
          WHERE event_name != 'exception'
          ORDER BY event_timestamp DESC
        `,
        query_params: { tenantId, traceId },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<{
        event_id: string;
        trace_id: string;
        project_id: string;
        started_at: string | number;
        event_type: string;
        attributes: Record<string, string>;
      }>;

      return rows.map((row) => {
        const startedAt =
          typeof row.started_at === "string"
            ? parseInt(row.started_at, 10)
            : row.started_at;

        const metrics: Array<{ key: string; value: number }> = [];
        const eventDetails: Array<{ key: string; value: string }> = [];

        for (const [key, value] of Object.entries(row.attributes)) {
          const isMetricKey =
            key === "vote" || key === "score" ||
            key.startsWith("metrics.") || key.startsWith("event.metrics.");
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
      });
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
      "Events.Attributes": span.events.map((e) => serializeAttributes(e.attributes)),
      "Links.TraceId": span.links.map((l) => l.traceId),
      "Links.SpanId": span.links.map((l) => l.spanId),
      "Links.Attributes": span.links.map((l) => serializeAttributes(l.attributes)),
      DroppedAttributesCount: 0,
      DroppedEventsCount: 0,
      DroppedLinksCount: 0,
      CreatedAt: new Date(),
      UpdatedAt: new Date(),
    } satisfies ClickHouseSpanWriteRecord;
  }
}
