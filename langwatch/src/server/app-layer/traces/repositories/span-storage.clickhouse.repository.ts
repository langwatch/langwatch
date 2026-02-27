import type { ClickHouseClient } from "@clickhouse/client";
import type { WithDateWrites } from "~/server/clickhouse/types";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { mapNormalizedSpansToSpans } from "~/server/traces/mappers/span.mapper";
import type { Span } from "~/server/tracer/types";
import { createLogger } from "~/utils/logger/server";
import type { SpanInsertData } from "../types";
import type { SpanStorageRepository } from "./span-storage.repository";

const TABLE_NAME = "stored_spans" as const;

const logger = createLogger(
  "langwatch:app-layer:traces:span-storage-repository",
);

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
  ResourceAttributes: Record<string, unknown>;
  SpanAttributes: Record<string, unknown>;
  StatusCode: number | null;
  StatusMessage: string | null;
  ScopeName: string;
  ScopeVersion: string | null;
  "Events.Timestamp": number[];
  "Events.Name": string[];
  "Events.Attributes": Record<string, unknown>[];
  "Links.TraceId": string[];
  "Links.SpanId": string[];
  "Links.Attributes": Record<string, unknown>[];
  DroppedAttributesCount: 0;
  DroppedEventsCount: 0;
  DroppedLinksCount: 0;
  CreatedAt: number;
  UpdatedAt: number;
}

export class SpanStorageClickHouseRepository implements SpanStorageRepository {
  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  async insertSpan(span: SpanInsertData): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: span.tenantId },
      "SpanStorageClickHouseRepository.insertSpan",
    );

    try {
      const record = this.toClickHouseRecord(span);
      await this.clickHouseClient.insert({
        table: TABLE_NAME,
        values: [record],
        format: "JSONEachRow",
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

  async getSpansByTraceId({ tenantId, traceId }: { tenantId: string; traceId: string }): Promise<Span[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "SpanStorageClickHouseRepository.getSpansByTraceId",
    );

    try {
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
          FROM (
            SELECT *
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND TraceId = {traceId:String}
            ORDER BY SpanId ASC, StartTime DESC
            LIMIT 1 BY TenantId, TraceId, SpanId
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
        kind: row.SpanKind,
        resourceAttributes: row.ResourceAttributes,
        spanAttributes: row.SpanAttributes,
        statusCode: row.StatusCode,
        statusMessage: row.StatusMessage,
        instrumentationScope: {
          name: row.ScopeName ?? "",
          version: row.ScopeVersion,
        },
        events: (row.Events_Timestamp ?? []).map((ts, i) => ({
          name: row.Events_Name?.[i] ?? "",
          timeUnixMs: ts,
          attributes: row.Events_Attributes?.[i] ?? {},
        })),
        links: (row.Links_TraceId ?? []).map((lt, i) => ({
          traceId: lt,
          spanId: row.Links_SpanId?.[i] ?? "",
          attributes: row.Links_Attributes?.[i] ?? {},
        })),
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return mapNormalizedSpansToSpans(normalizedSpans as any);
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
      ResourceAttributes: span.resourceAttributes,
      SpanAttributes: span.spanAttributes,
      StatusCode: span.statusCode,
      StatusMessage: span.statusMessage,
      ScopeName: span.instrumentationScope.name,
      ScopeVersion: span.instrumentationScope.version ?? null,
      "Events.Timestamp": span.events.map((e) => new Date(e.timeUnixMs)),
      "Events.Name": span.events.map((e) => e.name),
      "Events.Attributes": span.events.map((e) => e.attributes),
      "Links.TraceId": span.links.map((l) => l.traceId),
      "Links.SpanId": span.links.map((l) => l.spanId),
      "Links.Attributes": span.links.map((l) => l.attributes),
      DroppedAttributesCount: 0,
      DroppedEventsCount: 0,
      DroppedLinksCount: 0,
      CreatedAt: new Date(),
      UpdatedAt: new Date(),
    } satisfies ClickHouseSpanWriteRecord;
  }
}
