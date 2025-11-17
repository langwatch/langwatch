import { type ClickHouseClient } from "@clickhouse/client";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { generate } from "@langwatch/ksuid";

import type { SpanStore, SpanStoreCommand } from "./spanStore";
import { createLogger } from "../../../../../utils/logger";

export class SpanStoreClickHouse implements SpanStore {
  tracer = getLangWatchTracer("langwatch.span-store.clickhouse");
  logger = createLogger("langwatch:span-store:clickhouse");

  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  async insertSpan(command: SpanStoreCommand): Promise<void> {
    await this.tracer.withActiveSpan(
      "SpanStoreClickHouse.insertSpan",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": command.tenantId,
          "span.id": command.spanData.spanId,
          "trace.id": command.spanData.traceId,
        },
      },
      async (span) => {
        try {
          const spanRecord = this.transformSpanData(command);

          span.setAttribute("langwatch.span.id", spanRecord.Id);

          await this.clickHouseClient.insert({
            table: "observability_spans",
            values: [spanRecord],
            format: "JSONEachRow",
          });
        } catch (error) {
          this.logger.error(
            {
              tenantId: command.tenantId,
              spanId: command.spanData.spanId,
              traceId: command.spanData.traceId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to insert span into ClickHouse",
          );

          throw error;
        }
      },
    );
  }

  private transformSpanData(command: SpanStoreCommand): ClickHouseSpan {
    const { tenantId, spanData } = command;

    // Extract service name from resource attributes
    const serviceNameAny = spanData.resourceAttributes?.["service.name"];
    const serviceName =
      typeof serviceNameAny === "string" ? serviceNameAny : "unknown";

    return {
      Id: generate("span").toString(),
      Timestamp: spanData.startTimeUnixMs,
      TraceId: spanData.traceId,
      SpanId: spanData.spanId,
      ParentSpanId: spanData.parentSpanId,
      TraceState: spanData.traceState,
      SpanName: spanData.name,
      SpanKind: this.mapSpanKind(spanData.kind),
      ServiceName: serviceName,
      ResourceAttributes: spanData.resourceAttributes ?? {},
      ScopeName: spanData.instrumentationScope.name,
      ScopeVersion: spanData.instrumentationScope.version,
      SpanAttributes: spanData.attributes || {},
      Duration: spanData.durationMs,
      StatusCode: this.mapStatusCode(spanData.status.code),
      StatusMessage: spanData.status.message,
      "Events.Timestamp": spanData.events.map((event) => event.timeUnixMs),
      "Events.Name": spanData.events.map((event) => event.name),
      "Events.Attributes": spanData.events.map(
        (event) => event.attributes || {},
      ),
      "Links.TraceId": spanData.links.map((link) => link.traceId),
      "Links.SpanId": spanData.links.map((link) => link.spanId),
      "Links.TraceState": spanData.links.map((link) => link.traceState ?? ""),
      "Links.Attributes": spanData.links.map((link) => link.attributes ?? {}),
      LangWatchTenantId: tenantId,
    } satisfies ClickHouseSpan;
  }

  private mapSpanKind(kind: SpanKind): string {
    switch (kind) {
      case SpanKind.INTERNAL:
        return "INTERNAL";
      case SpanKind.SERVER:
        return "SERVER";
      case SpanKind.CLIENT:
        return "CLIENT";
      case SpanKind.PRODUCER:
        return "PRODUCER";
      case SpanKind.CONSUMER:
        return "CONSUMER";
      default:
        return "INTERNAL";
    }
  }

  private mapStatusCode(code: number): string {
    switch (code) {
      case 0:
        return "UNSET";
      case 1:
        return "OK";
      case 2:
        return "ERROR";
      default:
        return "UNSET";
    }
  }
}

type ClickHouseAttributeValue =
  | string
  | number
  | boolean
  | Array<null | undefined | string>
  | Array<null | undefined | number>
  | Array<null | undefined | boolean>;

type ClickHouseAttributes = Record<
  string,
  ClickHouseAttributeValue | undefined
>;

interface ClickHouseSpan {
  Id: string;
  Timestamp: number;
  TraceId: string;
  SpanId: string;
  ParentSpanId: string | null;
  TraceState: string | null;
  SpanName: string;
  SpanKind: string;
  ServiceName: string;
  ResourceAttributes: ClickHouseAttributes;
  ScopeName: string;
  ScopeVersion: string | null;
  SpanAttributes: ClickHouseAttributes;
  Duration: number;
  StatusCode: string;
  StatusMessage: string | null;
  "Events.Timestamp": number[];
  "Events.Name": string[];
  "Events.Attributes": ClickHouseAttributes[];
  "Links.TraceId": string[];
  "Links.SpanId": string[];
  "Links.TraceState": string[];
  "Links.Attributes": ClickHouseAttributes[];
  LangWatchTenantId: string;
}
