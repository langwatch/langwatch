import type { ClickHouseClient } from "@clickhouse/client";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../../utils/logger";
import type {
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../library";
import { createTenantId, EventUtils } from "../../../library";
import {
  ErrorCategory,
  StoreError,
  ValidationError,
  SecurityError,
} from "../../../library/services/errorHandling";
import type { SpanData } from "../schemas/commands";
import type { SpanProjection } from "../projections/spanProjection";
import type { SpanProjectionStore } from "./spanProjectionStore";

const TABLE_NAME = "ingested_spans" as const;

/**
 * ClickHouse record matching the ingested_spans table schema.
 */
interface ClickHouseSpanRecord {
  Id: string;
  TenantId: string;
  TraceId: string;
  SpanId: string;
  ParentSpanId: string | null;
  TraceState: string | null;
  Timestamp: number;
  Duration: number;
  SpanName: string;
  SpanKind: string;
  ServiceName: string;
  ScopeName: string;
  ScopeVersion: string | null;
  ResourceAttributes: Record<string, string>;
  SpanAttributes: Record<string, string>;
  StatusCode: string;
  StatusMessage: string | null;
  "Events.Timestamp": number[];
  "Events.Name": string[];
  "Events.Attributes": Record<string, string>[];
  "Links.TraceId": string[];
  "Links.SpanId": string[];
  "Links.TraceState": string[];
  "Links.Attributes": Record<string, string>[];
}

/**
 * ClickHouse implementation of the SpanProjectionStore.
 * Stores span projections to the ingested_spans table.
 */
export class SpanProjectionStoreClickHouse implements SpanProjectionStore {
  tracer = getLangWatchTracer("langwatch.span-storage.span-projection-store");
  logger = createLogger("langwatch:span-storage:span-projection-store");

  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  async getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<SpanProjection | null> {
    return await this.tracer.withActiveSpan(
      "SpanProjectionStoreClickHouse.getProjection",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.id": aggregateId,
          "tenant.id": context.tenantId,
        },
      },
      async () => {
        EventUtils.validateTenantId(
          context,
          "SpanProjectionStoreClickHouse.getProjection",
        );

        try {
          const result = await this.clickHouseClient.query({
            query: `
              SELECT
                Id,
                TenantId,
                TraceId,
                SpanId,
                ParentSpanId,
                TraceState,
                toUnixTimestamp64Milli(Timestamp) AS Timestamp,
                Duration,
                SpanName,
                SpanKind,
                ServiceName,
                ScopeName,
                ScopeVersion,
                ResourceAttributes,
                SpanAttributes,
                StatusCode,
                StatusMessage,
                arrayMap(x -> toUnixTimestamp64Milli(x), \`Events.Timestamp\`) AS \`Events.Timestamp\`,
                \`Events.Name\`,
                \`Events.Attributes\`,
                \`Links.TraceId\`,
                \`Links.SpanId\`,
                \`Links.TraceState\`,
                \`Links.Attributes\`
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
                AND SpanId = {spanId:String}
              LIMIT 1
            `,
            query_params: {
              tenantId: context.tenantId,
              spanId: aggregateId,
            },
            format: "JSONEachRow",
          });

          const rows = await result.json<ClickHouseSpanRecord>();
          const row = rows[0];
          if (!row) {
            return null;
          }

          return this.mapClickHouseRecordToProjection(row, context.tenantId);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            {
              spanId: aggregateId,
              tenantId: context.tenantId,
              error: errorMessage,
            },
            "Failed to get span projection from ClickHouse",
          );
          throw new StoreError(
            "getProjection",
            "SpanProjectionStoreClickHouse",
            `Failed to get span projection ${aggregateId}: ${errorMessage}`,
            ErrorCategory.CRITICAL,
            { spanId: aggregateId },
            error,
          );
        }
      },
    );
  }

  async storeProjection(
    projection: SpanProjection,
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    return await this.tracer.withActiveSpan(
      "SpanProjectionStoreClickHouse.storeProjection",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.id": projection.aggregateId,
          "tenant.id": context.tenantId,
        },
      },
      async () => {
        EventUtils.validateTenantId(
          context,
          "SpanProjectionStoreClickHouse.storeProjection",
        );

        if (!EventUtils.isValidProjection(projection)) {
          throw new ValidationError(
            "Invalid projection: projection must have id, aggregateId, tenantId, version, and data",
            "projection",
            projection,
          );
        }

        if (projection.tenantId !== context.tenantId) {
          throw new SecurityError(
            "storeProjection",
            `Projection has tenantId '${projection.tenantId}' that does not match context tenantId '${context.tenantId}'`,
            projection.tenantId,
            { contextTenantId: context.tenantId },
          );
        }

        try {
          const record = this.mapProjectionToClickHouseRecord(
            projection,
            String(context.tenantId),
          );

          await this.clickHouseClient.insert({
            table: TABLE_NAME,
            values: [record],
            format: "JSONEachRow",
          });

          this.logger.debug(
            {
              tenantId: context.tenantId,
              spanId: projection.aggregateId,
              projectionId: projection.id,
            },
            "Stored span projection to ClickHouse",
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            {
              tenantId: context.tenantId,
              spanId: projection.aggregateId,
              projectionId: projection.id,
              error: errorMessage,
            },
            "Failed to store span projection in ClickHouse",
          );
          throw new StoreError(
            "storeProjection",
            "SpanProjectionStoreClickHouse",
            `Failed to store span projection ${projection.id}: ${errorMessage}`,
            ErrorCategory.CRITICAL,
            { projectionId: projection.id, spanId: projection.aggregateId },
            error,
          );
        }
      },
    );
  }

  private mapProjectionToClickHouseRecord(
    projection: SpanProjection,
    tenantId: string,
  ): ClickHouseSpanRecord {
    const { spanData, collectedAtUnixMs } = projection.data;

    // Extract service name from resource attributes
    const serviceNameAny = spanData.resourceAttributes?.["service.name"];
    const serviceName =
      typeof serviceNameAny === "string" ? serviceNameAny : "unknown";

    return {
      Id: spanData.id,
      TenantId: tenantId,
      TraceId: spanData.traceId,
      SpanId: spanData.spanId,
      ParentSpanId: spanData.parentSpanId,
      TraceState: spanData.traceState,
      Timestamp: spanData.startTimeUnixMs,
      Duration: spanData.durationMs,
      SpanName: spanData.name,
      SpanKind: this.mapSpanKind(spanData.kind),
      ServiceName: serviceName,
      ScopeName: spanData.instrumentationScope.name,
      ScopeVersion: spanData.instrumentationScope.version,
      ResourceAttributes: this.stringifyAttributes(spanData.resourceAttributes),
      SpanAttributes: this.stringifyAttributes(spanData.attributes),
      StatusCode: this.mapStatusCode(spanData.status.code),
      StatusMessage: spanData.status.message,
      "Events.Timestamp": spanData.events.map((e) => e.timeUnixMs),
      "Events.Name": spanData.events.map((e) => e.name),
      "Events.Attributes": spanData.events.map((e) =>
        this.stringifyAttributes(e.attributes),
      ),
      "Links.TraceId": spanData.links.map((l) => l.traceId),
      "Links.SpanId": spanData.links.map((l) => l.spanId),
      "Links.TraceState": spanData.links.map((l) => l.traceState ?? ""),
      "Links.Attributes": spanData.links.map((l) =>
        this.stringifyAttributes(l.attributes),
      ),
    };
  }

  private mapClickHouseRecordToProjection(
    record: ClickHouseSpanRecord,
    tenantId: string,
  ): SpanProjection {
    const spanData: SpanData = {
      id: record.Id,
      aggregateId: record.SpanId,
      tenantId: record.TenantId,
      traceId: record.TraceId,
      spanId: record.SpanId,
      traceFlags: 0,
      traceState: record.TraceState,
      isRemote: false,
      parentSpanId: record.ParentSpanId,
      name: record.SpanName,
      kind: this.mapSpanKindFromString(record.SpanKind),
      startTimeUnixMs: record.Timestamp,
      endTimeUnixMs: record.Timestamp + record.Duration,
      attributes: this.parseAttributes(record.SpanAttributes),
      events: record["Events.Timestamp"].map((timestamp, index) => ({
        name: record["Events.Name"][index] ?? "",
        timeUnixMs: timestamp,
        attributes: this.parseAttributes(record["Events.Attributes"][index]),
      })),
      links: record["Links.TraceId"].map((traceId, index) => ({
        traceId,
        spanId: record["Links.SpanId"][index] ?? "",
        traceState: record["Links.TraceState"][index] ?? null,
        attributes: record["Links.Attributes"][index]
          ? this.parseAttributes(record["Links.Attributes"][index])
          : undefined,
      })),
      status: {
        code: this.mapStatusCodeFromString(record.StatusCode),
        message: record.StatusMessage,
      },
      resourceAttributes: this.parseAttributes(record.ResourceAttributes),
      instrumentationScope: {
        name: record.ScopeName,
        version: record.ScopeVersion,
      },
      durationMs: record.Duration,
      ended: true,
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    };

    return {
      id: record.Id,
      aggregateId: record.SpanId,
      tenantId: createTenantId(tenantId),
      version: record.Timestamp,
      data: {
        spanData,
        collectedAtUnixMs: record.Timestamp,
      },
    };
  }

  private stringifyAttributes(
    attrs:
      | Record<string, string | number | boolean | string[] | number[] | boolean[]>
      | undefined,
  ): Record<string, string> {
    if (!attrs) return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== undefined) {
        result[key] = typeof value === "string" ? value : JSON.stringify(value);
      }
    }
    return result;
  }

  private parseAttributes(
    attrs: Record<string, string> | undefined,
  ): Record<string, string | number | boolean | string[] | number[] | boolean[]> {
    if (!attrs) return {};
    const result: Record<
      string,
      string | number | boolean | string[] | number[] | boolean[]
    > = {};
    for (const [key, value] of Object.entries(attrs)) {
      // Try to parse JSON values back to their original types
      try {
        result[key] = JSON.parse(value) as
          | string
          | number
          | boolean
          | string[]
          | number[]
          | boolean[];
      } catch {
        result[key] = value;
      }
    }
    return result;
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
}

