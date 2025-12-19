import type { ClickHouseClient } from "@clickhouse/client";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "../../../../../utils/logger";
import type { SpanRepository } from "./spanRepository";
import type {
  NormalizedEvent,
  NormalizedLink,
  NormalizedSpan,
} from "../schemas/spans";
import { EventUtils } from "~/server/event-sourcing/library";

const TABLE_NAME = "stored_spans" as const;

/**
 * ClickHouse implementation of the SpanRepository.
 * Stores spans in the stored_spans table with idempotent inserts.
 */
export class SpanRepositoryClickHouse implements SpanRepository {
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.span-repository",
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:span-repository",
  );

  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  async insertSpan(normalizedSpan: NormalizedSpan): Promise<void> {
    await this.tracer.withActiveSpan(
      "SpanRepositoryClickHouse.insertSpan",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": normalizedSpan.tenantId,
          "span.id": normalizedSpan.spanId,
          "trace.id": normalizedSpan.traceId,
        },
      },
      async (span) => {
        EventUtils.validateTenantId(
          { tenantId: normalizedSpan.tenantId },
          "SpanRepositoryClickHouse.insertSpan",
        );

        try {
          const spanRecord = this.transformNormalizedSpan(normalizedSpan);

          span.setAttribute("langwatch.span.id", spanRecord.Id);

          // Use INSERT with idempotency: ClickHouse will ignore duplicates if primary key exists
          // The primary key is (TenantId, TraceId, SpanId) to ensure idempotency
          await this.clickHouseClient.insert({
            table: TABLE_NAME,
            values: [spanRecord],
            format: "JSONEachRow",
          });
        } catch (error) {
          this.logger.error(
            {
              tenantId: normalizedSpan.tenantId,
              spanId: normalizedSpan.spanId,
              traceId: normalizedSpan.traceId,
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
  ): Promise<NormalizedSpan | null> {
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
        EventUtils.validateTenantId(
          { tenantId },
          "SpanRepositoryClickHouse.getSpanByTraceIdAndSpanId",
        );

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
              FROM ${TABLE_NAME}
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

          return this.transformClickHouseSpanToNormalizedSpan(
            firstRow,
            tenantId,
          );
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
  ): Promise<NormalizedSpan[]> {
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
              FROM ${TABLE_NAME}
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
            this.transformClickHouseSpanToNormalizedSpan(
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

  private transformNormalizedSpan(
    normalizedSpan: NormalizedSpan,
  ): ClickHouseSpan {
    // Extract service name from resource attributes
    const serviceNameAny =
      normalizedSpan.spanAttributes["service.name"] ??
      normalizedSpan.resourceAttributes["service.name"];
    const serviceName =
      typeof serviceNameAny === "string" ? serviceNameAny : "unknown";

    return {
      Id: normalizedSpan.id,
      TenantId: normalizedSpan.tenantId,
      TraceId: normalizedSpan.traceId,
      SpanId: normalizedSpan.spanId,
      ParentSpanId: normalizedSpan.parentSpanId,
      ParentTraceId: normalizedSpan.parentTraceId,
      ParentIsRemote: normalizedSpan.parentIsRemote,
      Sampled: normalizedSpan.sampled,
      StartTime: normalizedSpan.startTimeUnixMs,
      EndTime: normalizedSpan.endTimeUnixMs,
      DurationMs: Math.round(normalizedSpan.durationMs),
      SpanName: normalizedSpan.name,
      SpanKind: normalizedSpan.kind,
      ServiceName: serviceName,
      ResourceAttributes: normalizedSpan.resourceAttributes,
      SpanAttributes: normalizedSpan.spanAttributes,
      StatusCode: normalizedSpan.statusCode,
      StatusMessage: normalizedSpan.statusMessage,
      ScopeName: normalizedSpan.instrumentationScope.name,
      ScopeVersion: normalizedSpan.instrumentationScope.version,
      "Events.Timestamp": normalizedSpan.events.map(
        (event) => event.timeUnixMs,
      ),
      "Events.Name": normalizedSpan.events.map((event) => event.name),
      "Events.Attributes": normalizedSpan.events.map(
        (event) => event.attributes,
      ),
      "Links.TraceId": normalizedSpan.links.map((link) => link.traceId),
      "Links.SpanId": normalizedSpan.links.map((link) => link.spanId),
      "Links.Attributes": normalizedSpan.links.map((link) => link.attributes),
      DroppedAttributesCount: normalizedSpan.droppedAttributesCount,
      DroppedEventsCount: normalizedSpan.droppedEventsCount,
      DroppedLinksCount: normalizedSpan.droppedLinksCount,
    } satisfies ClickHouseSpan;
  }

  private transformClickHouseSpanToNormalizedSpan(
    clickHouseSpan: ClickHouseSpan,
    tenantId: string,
  ): NormalizedSpan {
    // Reconstruct events array
    const events: NormalizedEvent[] = clickHouseSpan["Events.Timestamp"]
      .map((timestamp, index) => {
        const name = clickHouseSpan["Events.Name"][index];
        const attributes = clickHouseSpan["Events.Attributes"][index];

        // This should NEVER happen.
        if (!timestamp || !name || !attributes) {
          this.logger.error(
            {
              tenantId,
              traceId: clickHouseSpan.TraceId,
              spanId: clickHouseSpan.SpanId,
              eventIndex: index,
              nameEmpty: !name,
              attributesEmpty: !attributes,
              timestampEmpty: !timestamp,
            },
            "Event has no name, attributes, or timestamp",
          );

          return null;
        }

        return {
          name,
          timeUnixMs: timestamp,
          attributes,
        };
      })
      .filter((e) => e !== null);

    // Reconstruct links array
    const links: NormalizedLink[] = clickHouseSpan["Links.TraceId"]
      .map((traceId, index) => {
        const spanId = clickHouseSpan["Links.SpanId"][index];
        const attributes = clickHouseSpan["Links.Attributes"][index];

        // This should NEVER happen.
        if (!traceId || !spanId || !attributes) {
          this.logger.error(
            {
              tenantId,
              traceId: clickHouseSpan.TraceId,
              spanId: clickHouseSpan.SpanId,
              linkIndex: index,
              traceIdEmpty: !traceId,
              spanIdEmpty: !spanId,
              attributesEmpty: !attributes,
            },
            "Link has no trace id, span id, or attributes",
          );

          return null;
        }

        return {
          traceId,
          spanId,
          attributes,
        };
      })
      .filter((l) => l !== null);

    return {
      id: clickHouseSpan.Id,
      tenantId,
      traceId: clickHouseSpan.TraceId,
      spanId: clickHouseSpan.SpanId,
      parentSpanId: clickHouseSpan.ParentSpanId,
      parentTraceId: clickHouseSpan.ParentTraceId,
      parentIsRemote: clickHouseSpan.ParentIsRemote,
      sampled: clickHouseSpan.Sampled,
      startTimeUnixMs: clickHouseSpan.StartTime,
      endTimeUnixMs: clickHouseSpan.EndTime,
      durationMs: clickHouseSpan.DurationMs,
      name: clickHouseSpan.SpanName,
      kind: clickHouseSpan.SpanKind,
      resourceAttributes: clickHouseSpan.ResourceAttributes,
      spanAttributes: clickHouseSpan.SpanAttributes,
      statusCode: clickHouseSpan.StatusCode,
      statusMessage: clickHouseSpan.StatusMessage,
      instrumentationScope: {
        name: clickHouseSpan.ScopeName,
        version: clickHouseSpan.ScopeVersion,
      },
      events,
      links,
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
  | bigint
  | Array<string | number | boolean | bigint>;

type ClickHouseAttributes = Record<string, ClickHouseAttributeValue>;

interface ClickHouseSpan {
  Id: string;
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
  ResourceAttributes: ClickHouseAttributes;
  SpanAttributes: ClickHouseAttributes;
  StatusCode: number | null;
  StatusMessage: string | null;
  ScopeName: string;
  ScopeVersion: string | null;
  "Events.Timestamp": number[];
  "Events.Name": string[];
  "Events.Attributes": ClickHouseAttributes[];
  "Links.TraceId": string[];
  "Links.SpanId": string[];
  "Links.Attributes": ClickHouseAttributes[];
  DroppedAttributesCount: 0;
  DroppedEventsCount: 0;
  DroppedLinksCount: 0;
}
