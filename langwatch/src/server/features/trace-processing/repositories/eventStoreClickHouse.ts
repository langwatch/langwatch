import { type ClickHouseClient } from "@clickhouse/client";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { EventStore, EventStoreContext } from "./eventStore";
import type { SpanEvent } from "../types";
import { createLogger } from "../../../../utils/logger";

export class EventStoreClickHouse implements EventStore {
  tracer = getLangWatchTracer("langwatch.trace-processing.event-store.clickhouse");
  logger = createLogger("langwatch:trace-processing:event-store:clickhouse");

  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  async getEvents(
    traceId: string,
    context?: EventStoreContext
  ): Promise<SpanEvent[]> {
    const tenantId = context?.tenantId;
    if (!tenantId) {
      throw new Error("Tenant ID is required to load trace events");
    }
    return await this.tracer.withActiveSpan(
      "EventStoreClickHouse.getEvents",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "trace.id": traceId,
          "tenant.id": tenantId,
        },
      },
      async () => {
        try {
          // Query spans for this trace from ClickHouse
          const result = await this.clickHouseClient.query({
            query: `
              SELECT
                Id,
                Timestamp,
                TraceId,
                SpanId,
                ParentSpanId,
                TraceState,
                SpanName,
                SpanKind,
                ServiceName,
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
                Links.Attributes as LinksAttributes,
                LangWatchTenantId
              FROM observability_spans
              WHERE TraceId = {traceId:String} AND LangWatchTenantId = {tenantId:String}
              ORDER BY Timestamp ASC
            `,
            query_params: {
              traceId,
              tenantId,
            },
            format: "JSONEachRow",
          });

          const spans = await result.json();

          // Convert ClickHouse spans to SpanEvents
          return spans.map((span: any): SpanEvent => ({
            aggregateId: span.TraceId,
            timestamp: span.Timestamp,
            type: "span.ingested",
            data: {
              traceId: span.TraceId,
              spanId: span.SpanId,
              traceFlags: 0, // TODO: Map from ClickHouse data
              traceState: span.TraceState,
              isRemote: false,
              parentSpanId: span.ParentSpanId,
              name: span.SpanName,
              kind: this.mapSpanKind(span.SpanKind),
              startTimeUnixMs: span.Timestamp,
              endTimeUnixMs: span.Timestamp + span.Duration,
              attributes: span.SpanAttributes || {},
              events: this.mapEvents(span.EventsTimestamp, span.EventsName, span.EventsAttributes),
              links: this.mapLinks(span.LinksTraceId, span.LinksSpanId, span.LinksTraceState, span.LinksAttributes),
              status: {
                code: this.mapStatusCode(span.StatusCode),
                message: span.StatusMessage,
              },
              resourceAttributes: span.ResourceAttributes || {},
              instrumentationScope: {
                name: span.ScopeName,
                version: span.ScopeVersion,
              },
              durationMs: span.Duration,
              ended: true,
              droppedAttributesCount: 0,
              droppedEventsCount: 0,
              droppedLinksCount: 0,
            },
            metadata: {
              tenantId: span.LangWatchTenantId,
              collectedAtUnixMs: span.Timestamp,
            },
          }));
        } catch (error) {
          this.logger.error(
            {
              traceId,
              tenantId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to get events from ClickHouse"
          );
          throw error;
        }
      }
    );
  }

  async storeEvents(_events: SpanEvent[]): Promise<void> {
    // Events are already stored in ClickHouse via span ingestion
    // This method exists to satisfy the interface but is a no-op
  }

  private mapSpanKind(kind: string): SpanKind {
    switch (kind) {
      case "INTERNAL": return SpanKind.INTERNAL;
      case "SERVER": return SpanKind.SERVER;
      case "CLIENT": return SpanKind.CLIENT;
      case "PRODUCER": return SpanKind.PRODUCER;
      case "CONSUMER": return SpanKind.CONSUMER;
      default: return SpanKind.INTERNAL;
    }
  }

  private mapStatusCode(code: string): number {
    switch (code) {
      case "UNSET": return 0;
      case "OK": return 1;
      case "ERROR": return 2;
      default: return 0;
    }
  }

  private mapEvents(
    timestamps: number[],
    names: string[],
    attributes: Record<string, any>[]
  ): Array<{ name: string; timeUnixMs: number; attributes: Record<string, any> }> {
    if (!timestamps || !names) return [];

    return timestamps.map((timestamp, i) => ({
      name: names[i] ?? "",
      timeUnixMs: timestamp,
      attributes: attributes?.[i] ?? {},
    }));
  }

  private mapLinks(
    traceIds: string[],
    spanIds: string[],
    traceStates: string[],
    attributes: Record<string, any>[]
  ): Array<{ traceId: string; spanId: string; traceState: string | null; attributes: Record<string, any> }> {
    if (!traceIds || !spanIds) return [];

    return traceIds.map((traceId, i) => ({
      traceId,
      spanId: spanIds[i] ?? "",
      traceState: traceStates?.[i] ?? null,
      attributes: attributes?.[i] ?? {},
    }));
  }
}
