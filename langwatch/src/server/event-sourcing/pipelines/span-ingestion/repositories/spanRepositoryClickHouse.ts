import type { ClickHouseClient } from "@clickhouse/client";
import { generate } from "@langwatch/ksuid";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../../utils/logger";
import type {
  SpanData,
  StoreSpanIngestionCommandData,
} from "../schemas/commands";
import type { SpanRepository } from "./spanRepository";

export class SpanRepositoryClickHouse implements SpanRepository {
  tracer = getLangWatchTracer("langwatch.span-repository.clickhouse");
  logger = createLogger("langwatch:span-repository:clickhouse");

  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  async insertSpan(command: StoreSpanIngestionCommandData): Promise<void> {
    await this.tracer.withActiveSpan(
      "SpanRepositoryClickHouse.insertSpan",
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

          // Use INSERT with idempotency: ClickHouse will ignore duplicates if primary key exists
          // The primary key should be (TenantId, TraceId, SpanId) to ensure idempotency
          await this.clickHouseClient.insert({
            table: "ingested_spans",
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

  async getSpanByTraceIdAndSpanId(
    tenantId: string,
    traceId: string,
    spanId: string,
  ): Promise<SpanData | null> {
    return await this.tracer.withActiveSpan(
      "SpanRepositoryClickHouse.getSpanByTraceIdAndSpanId",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": tenantId,
          "span.id": spanId,
          "trace.id": traceId,
        },
      },
      async () => {
        try {
          const result = await this.clickHouseClient.query({
            query: `
              SELECT
                Id,
                TraceId AS AggregateId,
                TenantId,
                toUnixTimestamp64Milli(Timestamp) AS Timestamp,
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
                arrayMap(x -> toUnixTimestamp64Milli(x), \`Events.Timestamp\`) AS \`Events.Timestamp\`,
                \`Events.Name\`,
                \`Events.Attributes\`,
                \`Links.TraceId\`,
                \`Links.SpanId\`,
                \`Links.TraceState\`,
                \`Links.Attributes\`
              FROM ingested_spans
              WHERE TenantId = {tenantId:String}
                AND TraceId = {traceId:String}
                AND SpanId = {spanId:String}
              LIMIT 1
            `,
            query_params: {
              tenantId,
              traceId,
              spanId,
            },
            format: "JSONEachRow",
          });

          const jsonResult = await result.json();
          const rows = Array.isArray(jsonResult) ? jsonResult : [];

          if (rows.length === 0) {
            return null;
          }

          const firstRow = rows[0] as ClickHouseSpan;
          if (!firstRow) {
            return null;
          }

          return this.transformClickHouseSpanToSpanData(firstRow, tenantId);
        } catch (error) {
          this.logger.error(
            {
              tenantId,
              spanId,
              traceId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to get span from ClickHouse",
          );

          throw error;
        }
      },
    );
  }

  async getSpansByTraceId(
    tenantId: string,
    traceId: string,
  ): Promise<SpanData[]> {
    return await this.tracer.withActiveSpan(
      "SpanRepositoryClickHouse.getSpansByTraceId",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": tenantId,
          "trace.id": traceId,
        },
      },
      async () => {
        try {
          const result = await this.clickHouseClient.query({
            query: `
              SELECT
                Id,
                TraceId AS AggregateId,
                TenantId,
                toUnixTimestamp64Milli(Timestamp) AS Timestamp,
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
                arrayMap(x -> toUnixTimestamp64Milli(x), \`Events.Timestamp\`) AS \`Events.Timestamp\`,
                \`Events.Name\`,
                \`Events.Attributes\`,
                \`Links.TraceId\`,
                \`Links.SpanId\`,
                \`Links.TraceState\`,
                \`Links.Attributes\`
              FROM ingested_spans
              WHERE TenantId = {tenantId:String}
                AND TraceId = {traceId:String}
              ORDER BY Timestamp ASC
            `,
            query_params: {
              tenantId,
              traceId,
            },
            format: "JSONEachRow",
          });

          const jsonResult = await result.json();
          const rows = Array.isArray(jsonResult) ? jsonResult : [];

          return rows.map((row: unknown) =>
            this.transformClickHouseSpanToSpanData(
              row as ClickHouseSpan,
              tenantId,
            ),
          );
        } catch (error) {
          this.logger.error(
            {
              tenantId,
              traceId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to get spans from ClickHouse",
          );

          throw error;
        }
      },
    );
  }

  private transformSpanData(
    command: StoreSpanIngestionCommandData,
  ): ClickHouseSpan {
    const { tenantId, spanData, collectedAtUnixMs } = command;

    // Extract service name from resource attributes
    const serviceNameAny = spanData.resourceAttributes?.["service.name"];
    const serviceName =
      typeof serviceNameAny === "string" ? serviceNameAny : "unknown";

    return {
      Id: generate("span").toString(),
      AggregateId: spanData.traceId, // Aggregate ID is the traceId
      Timestamp: spanData.startTimeUnixMs,
      TenantId: tenantId,
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
      "Events.Timestamp": spanData.events.map(
        (event: SpanData["events"][number]) => event.timeUnixMs,
      ),
      "Events.Name": spanData.events.map(
        (event: SpanData["events"][number]) => event.name,
      ),
      "Events.Attributes": spanData.events.map(
        (event: SpanData["events"][number]) => event.attributes || {},
      ),
      "Links.TraceId": spanData.links.map(
        (link: SpanData["links"][number]) => link.traceId,
      ),
      "Links.SpanId": spanData.links.map(
        (link: SpanData["links"][number]) => link.spanId,
      ),
      "Links.TraceState": spanData.links.map(
        (link: SpanData["links"][number]) => link.traceState ?? "",
      ),
      "Links.Attributes": spanData.links.map(
        (link: SpanData["links"][number]) => link.attributes ?? {},
      ),
      CollectedAt: collectedAtUnixMs,
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

  private mapStatusCodeFromString(statusCode: string): number {
    switch (statusCode) {
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

  private mapSpanKindFromString(kind: string): SpanKind {
    switch (kind) {
      case "INTERNAL":
        return SpanKind.INTERNAL;
      case "SERVER":
        return SpanKind.SERVER;
      case "CLIENT":
        return SpanKind.CLIENT;
      case "PRODUCER":
        return SpanKind.PRODUCER;
      case "CONSUMER":
        return SpanKind.CONSUMER;
      default:
        return SpanKind.INTERNAL;
    }
  }

  private filterUndefinedAttributes(
    attrs: ClickHouseAttributes | undefined,
  ): Record<
    string,
    string | number | boolean | string[] | number[] | boolean[]
  > {
    if (!attrs) return {};
    const result: Record<
      string,
      string | number | boolean | string[] | number[] | boolean[]
    > = {};
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== undefined) {
        result[key] = value as
          | string
          | number
          | boolean
          | string[]
          | number[]
          | boolean[];
      }
    }
    return result;
  }

  private transformClickHouseSpanToSpanData(
    clickHouseSpan: ClickHouseSpan,
    tenantId: string,
  ): SpanData {
    // Reconstruct events array
    const events = clickHouseSpan["Events.Timestamp"].map(
      (timestamp, index) => ({
        name: clickHouseSpan["Events.Name"][index] ?? "",
        timeUnixMs: timestamp,
        attributes: this.filterUndefinedAttributes(
          clickHouseSpan["Events.Attributes"][index],
        ),
      }),
    );

    // Reconstruct links array
    const links = clickHouseSpan["Links.TraceId"].map((traceId, index) => ({
      traceId,
      spanId: clickHouseSpan["Links.SpanId"][index] ?? "",
      traceState: clickHouseSpan["Links.TraceState"][index] ?? null,
      attributes: clickHouseSpan["Links.Attributes"][index]
        ? this.filterUndefinedAttributes(
            clickHouseSpan["Links.Attributes"][index],
          )
        : undefined,
    }));

    // Timestamp is already converted to Unix milliseconds by ClickHouse query
    const startTimeUnixMs = clickHouseSpan.Timestamp;
    const endTimeUnixMs = clickHouseSpan.Timestamp + clickHouseSpan.Duration;

    return {
      id: clickHouseSpan.Id,
      aggregateId: clickHouseSpan.AggregateId,
      tenantId,
      traceId: clickHouseSpan.TraceId,
      spanId: clickHouseSpan.SpanId,
      traceFlags: 0, // Not stored in ClickHouse, default to 0
      traceState: clickHouseSpan.TraceState,
      isRemote: false, // Not stored in ClickHouse, default to false
      parentSpanId: clickHouseSpan.ParentSpanId,
      name: clickHouseSpan.SpanName,
      kind: this.mapSpanKindFromString(clickHouseSpan.SpanKind),
      startTimeUnixMs,
      endTimeUnixMs,
      attributes: this.filterUndefinedAttributes(clickHouseSpan.SpanAttributes),
      events,
      links,
      status: {
        code: this.mapStatusCodeFromString(clickHouseSpan.StatusCode),
        message: clickHouseSpan.StatusMessage,
      },
      resourceAttributes: clickHouseSpan.ResourceAttributes
        ? this.filterUndefinedAttributes(clickHouseSpan.ResourceAttributes)
        : undefined,
      instrumentationScope: {
        name: clickHouseSpan.ScopeName,
        version: clickHouseSpan.ScopeVersion,
      },
      durationMs: clickHouseSpan.Duration,
      ended: true, // All stored spans are ended
      droppedAttributesCount: 0, // Not stored in ClickHouse
      droppedEventsCount: 0, // Not stored in ClickHouse
      droppedLinksCount: 0, // Not stored in ClickHouse
    };
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
  AggregateId: string;
  TenantId: string;
  Timestamp: number; // Converted to Unix milliseconds by toUnixTimestamp64Milli() in query
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
  CollectedAt?: number; // Only present when inserting, not when reading
}
