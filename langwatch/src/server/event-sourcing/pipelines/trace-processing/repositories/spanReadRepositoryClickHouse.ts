import { type ClickHouseClient } from "@clickhouse/client";
import type { Attributes, AttributeValue } from "@opentelemetry/api";

import type { SpanData } from "../../span-processing/types";

export interface SpanReadRepository {
  getSpansForTrace(tenantId: string, traceId: string): Promise<SpanData[]>;
}

export class SpanReadRepositoryClickHouse implements SpanReadRepository {
  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  async getSpansForTrace(
    tenantId: string,
    traceId: string,
  ): Promise<SpanData[]> {
    const result = await this.clickHouseClient.query({
      query: `
        SELECT
          Timestamp,
          TraceId,
          SpanId,
          ParentSpanId,
          TraceState,
          SpanName,
          SpanKind,
          ResourceAttributes,
          ScopeName,
          ScopeVersion,
          SpanAttributes,
          Duration,
          StatusCode,
          StatusMessage,
          Events.Timestamp as EventsTimestamp,
          Events.Name as EventsName,
          Events.Attributes as EventsAttributes,
          Links.TraceId as LinksTraceId,
          Links.SpanId as LinksSpanId,
          Links.TraceState as LinksTraceState,
          Links.Attributes as LinksAttributes
        FROM observability_spans
        WHERE TraceId = {traceId:String}
          AND LangWatchTenantId = {tenantId:String}
        ORDER BY Timestamp ASC
      `,
      query_params: {
        traceId,
        tenantId,
      },
      format: "JSONEachRow",
    });

    const rows: Array<{
      Timestamp: number;
      TraceId: string;
      SpanId: string;
      ParentSpanId: string | null;
      TraceState: string | null;
      SpanName: string;
      SpanKind: string;
      ResourceAttributes: Record<string, unknown>;
      ScopeName: string;
      ScopeVersion: string | null;
      SpanAttributes: Record<string, unknown>;
      Duration: number;
      StatusCode: string;
      StatusMessage: string | null;
      EventsTimestamp: number[];
      EventsName: string[];
      EventsAttributes: Record<string, unknown>[];
      LinksTraceId: string[];
      LinksSpanId: string[];
      LinksTraceState: string[];
      LinksAttributes: Record<string, unknown>[];
    }> = await result.json();

    return rows.map(
      (row): SpanData => ({
        traceId: row.TraceId,
        spanId: row.SpanId,
        traceFlags: 0,
        traceState: row.TraceState,
        isRemote: false,
        parentSpanId: row.ParentSpanId,
        name: row.SpanName,
        kind: this.mapSpanKind(row.SpanKind),
        startTimeUnixMs: row.Timestamp,
        endTimeUnixMs: row.Timestamp + row.Duration,
        attributes: (row.SpanAttributes ?? {}) as Attributes,
        events: this.mapEvents(
          row.EventsTimestamp,
          row.EventsName,
          row.EventsAttributes,
        ),
        links: this.mapLinks(
          row.LinksTraceId,
          row.LinksSpanId,
          row.LinksTraceState,
          row.LinksAttributes,
        ),
        status: {
          code: this.mapStatusCode(row.StatusCode),
          message: row.StatusMessage,
        },
        resourceAttributes: (row.ResourceAttributes ?? {}) as Attributes,
        instrumentationScope: {
          name: row.ScopeName,
          version: row.ScopeVersion,
        },
        durationMs: row.Duration,
        ended: true,
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      }),
    );
  }

  private mapSpanKind(kind: string): number {
    switch (kind) {
      case "INTERNAL":
        return 0;
      case "SERVER":
        return 1;
      case "CLIENT":
        return 2;
      case "PRODUCER":
        return 3;
      case "CONSUMER":
        return 4;
      default:
        return 0;
    }
  }

  private mapStatusCode(code: string): number {
    switch (code) {
      case "UNSET":
        return 0;
      case "OK":
        return 1;
      case "ERROR":
        return 2;
      default:
        return 0;
    }
  }

  private mapEvents(
    timestamps: number[],
    names: string[],
    attributes: Record<string, unknown>[],
  ): Array<{
    name: string;
    timeUnixMs: number;
    attributes: Attributes;
  }> {
    if (!timestamps || !names) return [];

    return timestamps.map((timestamp, i) => ({
      name: names[i] ?? "",
      timeUnixMs: timestamp,
      attributes: (attributes?.[i] ?? {}) as Attributes,
    }));
  }

  private mapLinks(
    traceIds: string[],
    spanIds: string[],
    traceStates: string[],
    attributes: Record<string, unknown>[],
  ): Array<{
    traceId: string;
    spanId: string;
    traceState: string | null;
    attributes: Attributes | undefined;
  }> {
    if (!traceIds || !spanIds) return [];

    return traceIds.map((traceId, i) => ({
      traceId,
      spanId: spanIds[i] ?? "",
      traceState: traceStates?.[i] ?? null,
      attributes: (attributes?.[i] ?? {}) as Attributes | undefined,
    }));
  }
}
