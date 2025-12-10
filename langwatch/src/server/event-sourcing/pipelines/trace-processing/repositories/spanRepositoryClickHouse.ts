import type { ClickHouseClient } from "@clickhouse/client";
import { generate } from "@langwatch/ksuid";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../../utils/logger";
import type { SpanData } from "../schemas/commands";
import type { SpanRepository, StoreSpanData } from "./spanRepository";

/**
 * ClickHouse implementation of the SpanRepository.
 * Stores spans in the ingested_spans table with idempotent inserts.
 */
export class SpanRepositoryClickHouse implements SpanRepository {
  tracer = getLangWatchTracer("langwatch.trace-processing.span-repository");
  logger = createLogger("langwatch:trace-processing:span-repository");

  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  async insertSpan(data: StoreSpanData): Promise<void> {
    await this.tracer.withActiveSpan(
      "SpanRepositoryClickHouse.insertSpan",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": data.tenantId,
          "span.id": data.spanData.spanId,
          "trace.id": data.spanData.traceId,
        },
      },
      async (span) => {
        try {
          const spanRecord = this.transformSpanData(data);

          span.setAttribute("langwatch.span.id", spanRecord.Id);

          // Use INSERT with idempotency: ClickHouse will ignore duplicates if primary key exists
          // The primary key is (TenantId, TraceId, SpanId) to ensure idempotency
          await this.clickHouseClient.insert({
            table: "ingested_spans",
            values: [spanRecord],
            format: "JSONEachRow",
          });
        } catch (error) {
          this.logger.error(
            {
              tenantId: data.tenantId,
              spanId: data.spanData.spanId,
              traceId: data.spanData.traceId,
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

  private transformSpanData(data: StoreSpanData): ClickHouseSpan {
    const { tenantId, spanData, collectedAtUnixMs } = data;

    // Extract service name from resource attributes
    const serviceNameAny = spanData.resourceAttributes?.["service.name"];
    const serviceName =
      typeof serviceNameAny === "string" ? serviceNameAny : "unknown";

    // Use the id from spanData if available, otherwise generate
    const id = spanData.id || generate("span").toString();

    return {
      Id: id,
      AggregateId: spanData.traceId,
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

  private mapSpanKind(kind: number): string {
    switch (kind) {
      case 0:
        return "INTERNAL";
      case 1:
        return "SERVER";
      case 2:
        return "CLIENT";
      case 3:
        return "PRODUCER";
      case 4:
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

  private mapSpanKindFromString(kind: string): number {
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
      traceFlags: 0,
      traceState: clickHouseSpan.TraceState,
      isRemote: false,
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
      ended: true,
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
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
  CollectedAt?: number;
}

