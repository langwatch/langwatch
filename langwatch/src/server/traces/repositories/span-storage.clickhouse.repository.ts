import type { ClickHouseClient } from "@clickhouse/client";
import type { Span } from "~/server/tracer/types";
import { mapNormalizedSpansToSpans } from "~/server/traces/mappers/span.mapper";
import type {
  NormalizedSpan,
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";

export interface SpanStorageRepository {
  getSpansByTraceId(tenantId: string, traceId: string): Promise<Span[]>;
}

export class SpanStorageClickHouseRepository implements SpanStorageRepository {
  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  async getSpansByTraceId(tenantId: string, traceId: string): Promise<Span[]> {
    const result = await this.clickHouseClient.query({
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
        FROM stored_spans
        WHERE TenantId = {tenantId:String}
          AND TraceId = {traceId:String}
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

    const normalizedSpans: NormalizedSpan[] = rows.map((row) => ({
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
      kind: row.SpanKind as NormalizedSpanKind,
      resourceAttributes:
        row.ResourceAttributes as NormalizedSpan["resourceAttributes"],
      spanAttributes: row.SpanAttributes as NormalizedSpan["spanAttributes"],
      statusCode: row.StatusCode as NormalizedStatusCode | null,
      statusMessage: row.StatusMessage,
      instrumentationScope: {
        name: row.ScopeName ?? "",
        version: row.ScopeVersion,
      },
      events: (row.Events_Timestamp ?? []).map((ts, i) => ({
        name: row.Events_Name?.[i] ?? "",
        timeUnixMs: ts,
        attributes: (row.Events_Attributes?.[i] ??
          {}) as NormalizedSpan["events"][number]["attributes"],
      })),
      links: (row.Links_TraceId ?? []).map((lt, i) => ({
        traceId: lt,
        spanId: row.Links_SpanId?.[i] ?? "",
        attributes: (row.Links_Attributes?.[i] ??
          {}) as NormalizedSpan["links"][number]["attributes"],
      })),
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    }));

    return mapNormalizedSpansToSpans(normalizedSpans);
  }
}
