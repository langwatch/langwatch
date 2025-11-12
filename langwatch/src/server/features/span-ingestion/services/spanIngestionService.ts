import {
  SpanKind as ApiSpanKind,
  SpanStatusCode,
  TraceFlags,
  type Attributes,
  type Link,
  type SpanKind,
  type SpanStatus,
  type SpanContext,
  type HrTime,
} from "@opentelemetry/api";
import type { TimedEvent, ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { getLangWatchTracer } from "langwatch";
import {
  resourceFromAttributes,
  type DetectedResourceAttributes,
} from "@opentelemetry/resources";

import type { TraceForCollection } from "../../../tracer/otel.traces";
import { otelAttributesToNestedAttributes } from "../../../tracer/otel.traces";
import type { DeepPartial } from "../../../../utils/types";
import type {
  IExportTraceServiceRequest,
  IEvent,
  ILink,
} from "@opentelemetry/otlp-transformer";
import { mapReadableSpansToClickHouseSpans } from "../mapping/mapTraceToClickHouseSpans";
import {
  type SpanIngestionWriteProducer,
  spanIngestionWriteProducer,
} from "../producers/spanIngestionWriteProducer";
import type { SpanIngestionWriteRecord, IngestedSpan } from "../types";
import type { Span } from "../../../tracer/types";
import { createLogger } from "../../../../utils/logger";

interface OtelSpanMetadata {
  traceState: string | null;
  spanKind?: SpanKind;
  resourceAttributes: Record<string, unknown>;
  spanAttributes: Attributes;
  scopeName: string;
  scopeVersion: string;
  schemaUrl?: string;
  events: TimedEvent[];
  links: Link[];
};

export class SpanIngestionService {
  tracer = getLangWatchTracer("langwatch.span-ingestion.service");
  logger = createLogger("langwatch.span-ingestion.service");

  constructor(private readonly producer: SpanIngestionWriteProducer) {}

  async queueIngestedSpan(
    tenantId: string,
    traceForCollection: TraceForCollection,
    traceRequest: DeepPartial<IExportTraceServiceRequest>,
  ): Promise<void> {
    return await this.tracer.withActiveSpan(
      "SpanIngestionService.queueIngestedSpan",
      {
        kind: ApiSpanKind.PRODUCER,
        attributes: {
          "tenant.id": tenantId,
          "trace.id": traceForCollection.traceId,
          "spans.count": traceForCollection.spans.length,
        },
      },
      async (span) => {
        const records = this.buildReadableSpanRecords(
          tenantId,
          traceForCollection,
          traceRequest,
        );
        const clickHouseSpans = mapReadableSpansToClickHouseSpans(
          records,
          tenantId,
        );

        if (clickHouseSpans.length === 0) {
          this.logger.debug(
            {
              tenantId,
              traceId: traceForCollection.traceId,
            },
            "No spans mapped for ClickHouse ingestion",
          );
          return;
        }

        await this.enqueueMappedIngestedSpans(
          tenantId,
          traceForCollection.traceId,
          clickHouseSpans,
        );

        span.setAttributes({
          "clickhouse.spans.enqueued": clickHouseSpans.length,
          "clickhouse.spans.enqueued_ids": clickHouseSpans.map(
            (clickHouseSpan) => clickHouseSpan.id,
          ),
        });
      },
    );
  }

  private async enqueueMappedIngestedSpans(
    tenantId: string,
    traceId: string,
    spans: IngestedSpan[],
  ): Promise<void> {
    await this.tracer.withActiveSpan(
      "SpanIngestionService.enqueueMappedSpans",
      {
        kind: ApiSpanKind.INTERNAL,
        attributes: {
          "tenant.id": tenantId,
          "trace.id": traceId,
          "spans.count": spans.length,
        },
      },
      async (span) => {
        const collectedAt = Date.now();

        const results = await Promise.allSettled(
          spans.map(async (clickHouseSpan) => {
            await this.producer.enqueueSpanWriteJob(
              tenantId,
              traceId,
              clickHouseSpan,
              collectedAt,
            );
          }),
        );

        const failed = results.filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );

        span.setAttributes({
          "queue.jobs.total": spans.length,
          "queue.jobs.failed": failed.length,
        });

        if (failed.length > 0) {
          this.logger.error(
            {
              projectId: tenantId,
              traceId,
              failedJobs: failed.length,
            },
            "failed to enqueue ClickHouse span jobs",
          );
        }
      },
    );
  }

  private buildReadableSpanRecords(
    tenantId: string,
    trace: TraceForCollection,
    traceRequest: DeepPartial<IExportTraceServiceRequest>,
  ): SpanIngestionWriteRecord[] {
    return this.tracer.withActiveSpan(
      "SpanIngestionService.buildReadableSpanRecords",
      {
        kind: ApiSpanKind.INTERNAL,
        attributes: {
          "trace.id": trace.traceId,
          "spans.count": trace.spans.length,
        },
      },
      () => {
        const metadataBySpanId = this.buildOtelSpanMetadata(
          traceRequest,
          trace.traceId,
        );
        return trace.spans.map((originalSpan) => {
          const metadata = metadataBySpanId.get(originalSpan.span_id);
          const startTime = this.toHrTime(originalSpan.timestamps.started_at);
          const endTime = this.toHrTime(originalSpan.timestamps.finished_at);
          const duration = this.toHrTime(
            Math.max(
              0,
              originalSpan.timestamps.finished_at -
                originalSpan.timestamps.started_at,
            ),
          );

          const readableSpan: ReadableSpan = {
            name: originalSpan.name ?? "unknown",
            kind:
              metadata?.spanKind ??
              this.mapSpanTypeToSpanKind(originalSpan.type),
            spanContext: () => this.buildSpanContext(originalSpan),
            parentSpanContext: originalSpan.parent_id
              ? {
                  traceId: originalSpan.trace_id,
                  spanId: originalSpan.parent_id,
                  traceFlags: TraceFlags.SAMPLED,
                  isRemote: false,
                }
              : undefined,
            startTime,
            endTime,
            status: this.buildSpanStatus(originalSpan),
            attributes: metadata?.spanAttributes ?? {},
            links: metadata?.links ?? [],
            events: metadata?.events ?? [],
            duration,
            ended: true,
            resource: resourceFromAttributes(
              this.sanitizeResourceAttributes(
                metadata?.resourceAttributes ?? {},
              ),
            ),
            instrumentationScope: {
              name: metadata?.scopeName ?? "",
              version: metadata?.scopeVersion ?? "",
              schemaUrl: metadata?.schemaUrl,
            },
            droppedAttributesCount: 0,
            droppedEventsCount: 0,
            droppedLinksCount: 0,
          } as ReadableSpan;

          return {
            readableSpan,
            originalSpan,
            tenantId,
            traceState: metadata?.traceState ?? null,
          } satisfies SpanIngestionWriteRecord;
        });
      },
    );
  }

  private buildSpanContext(span: Span): SpanContext {
    return {
      traceId: span.trace_id,
      spanId: span.span_id,
      traceFlags: TraceFlags.SAMPLED,
      isRemote: false,
    };
  }

  private buildSpanStatus(span: Span): SpanStatus {
    if (span.error?.has_error) {
      return {
        code: SpanStatusCode.ERROR,
        message: span.error.message,
      };
    }

    return { code: SpanStatusCode.OK };
  }

  private buildOtelSpanMetadata(
    traceRequest: DeepPartial<IExportTraceServiceRequest>,
    traceId: string,
  ): Map<string, OtelSpanMetadata> {
    return this.tracer.withActiveSpan(
      "SpanIngestionService.buildOtelSpanMetadata",
      { kind: ApiSpanKind.INTERNAL },
      (span) => {
        const metadata = new Map<string, OtelSpanMetadata>();

        try {
          for (const resourceSpan of traceRequest.resourceSpans ?? []) {
            const resourceAttributes = this.sanitizeAttributes(
              otelAttributesToNestedAttributes(
                resourceSpan?.resource?.attributes,
              ) ?? {},
            );

            for (const scopeSpan of resourceSpan?.scopeSpans ?? []) {
              const scopeName = scopeSpan?.scope?.name ?? "";
              const scopeVersion = scopeSpan?.scope?.version ?? "";
              const schemaUrl = scopeSpan?.schemaUrl ?? undefined;

              for (const otelSpan of scopeSpan?.spans ?? []) {
                if (!otelSpan?.spanId) continue;
                if (otelSpan.traceId !== traceId) continue;

                const spanAttributes = this.sanitizeAttributes(
                  otelAttributesToNestedAttributes(otelSpan?.attributes) ?? {},
                );

                metadata.set(otelSpan.spanId as string, {
                  traceState:
                    typeof otelSpan.traceState === "string"
                      ? otelSpan.traceState
                      : null,
                  spanKind: this.mapOtelSpanKind(otelSpan.kind),
                  resourceAttributes,
                  spanAttributes,
                  scopeName,
                  scopeVersion,
                  schemaUrl,
                  events: this.mapOtelEvents(
                    (otelSpan.events as DeepPartial<IEvent>[] | undefined) ??
                      [],
                  ),
                  links: this.mapOtelLinks(
                    (otelSpan.links as DeepPartial<ILink>[] | undefined) ?? [],
                  ),
                });
              }
            }
          }
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : "Unknown error",
          });
          span.recordException(
            error instanceof Error ? error : new Error(String(error)),
          );
          throw error;
        }

        span.setAttribute("span.metadata.count", metadata.size);

        return metadata;
      },
    );
  }

  private mapOtelSpanKind(kind: unknown): SpanKind | undefined {
    if (typeof kind === "number") {
      switch (kind) {
        case ApiSpanKind.CLIENT:
          return ApiSpanKind.CLIENT;
        case ApiSpanKind.SERVER:
          return ApiSpanKind.SERVER;
        case ApiSpanKind.CONSUMER:
          return ApiSpanKind.CONSUMER;
        case ApiSpanKind.PRODUCER:
          return ApiSpanKind.PRODUCER;
        case ApiSpanKind.INTERNAL:
          return ApiSpanKind.INTERNAL;
        default:
          return undefined;
      }
    }
    return undefined;
  }

  private mapSpanTypeToSpanKind(spanType: Span["type"]): SpanKind {
    switch (spanType) {
      case "server":
        return ApiSpanKind.SERVER;
      case "client":
        return ApiSpanKind.CLIENT;
      case "producer":
        return ApiSpanKind.PRODUCER;
      case "consumer":
        return ApiSpanKind.CONSUMER;
      default:
        return ApiSpanKind.INTERNAL;
    }
  }

  private mapOtelEvents(
    events: DeepPartial<IEvent>[] | null | undefined,
  ): TimedEvent[] {
    if (!events) return [];

    const result: TimedEvent[] = [];
    for (const event of events) {
      if (!event) continue;
      result.push({
        time: this.parseUnixNanoToHrTime(event.timeUnixNano) ?? [0, 0],
        name: event.name ?? "",
        attributes: this.sanitizeAttributes(
          otelAttributesToNestedAttributes(event.attributes) ?? {},
        ),
        droppedAttributesCount: Number(event.droppedAttributesCount ?? 0),
      });
    }
    return result;
  }

  private mapOtelLinks(links: DeepPartial<ILink>[] | null | undefined): Link[] {
    if (!links) return [];

    const result: Link[] = [];
    for (const link of links) {
      if (!link) continue;
      if (typeof link.traceId !== "string" || typeof link.spanId !== "string") {
        continue;
      }

      result.push({
        context: {
          traceId: link.traceId,
          spanId: link.spanId,
          traceFlags: TraceFlags.SAMPLED,
        },
        attributes: this.sanitizeAttributes(
          otelAttributesToNestedAttributes(link.attributes) ?? {},
        ),
        droppedAttributesCount: Number(link.droppedAttributesCount ?? 0),
      });
    }
    return result;
  }

  private parseUnixNanoToHrTime(value: unknown): HrTime | undefined {
    const millis = this.parseUnixNano(value);
    if (millis === undefined) return undefined;
    return this.toHrTime(millis);
  }

  private parseUnixNano(value: unknown): number | undefined {
    if (typeof value === "number") {
      return Math.round(value / 1_000_000);
    }

    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed)
        ? Math.round(parsed / 1_000_000)
        : undefined;
    }

    if (
      value &&
      typeof value === "object" &&
      "low" in (value as Record<string, unknown>) &&
      "high" in (value as Record<string, unknown>)
    ) {
      const { high, low } = value as {
        high: number;
        low: number;
      };

      const result = (BigInt(high) << 32n) | (BigInt(low) & 0xffffffffn);
      return Number(result) / 1_000_000;
    }

    return undefined;
  }

  private toHrTime(milliseconds: number): HrTime {
    const seconds = Math.floor(milliseconds / 1000);
    const nanoseconds = Math.floor((milliseconds % 1000) * 1_000_000);
    return [seconds, nanoseconds];
  }

  private sanitizeAttributes(source: Record<string, unknown>): Attributes {
    const target: Attributes = {};

    for (const [key, value] of Object.entries(source)) {
      if (value === undefined || value === null) continue;

      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        target[key] = value;
        continue;
      }

      if (Array.isArray(value)) {
        target[key] = value
          .map((item) => {
            if (
              typeof item === "string" ||
              typeof item === "number" ||
              typeof item === "boolean"
            ) {
              return String(item);
            }
            if (item === null || item === undefined) {
              return undefined;
            }
            return JSON.stringify(item);
          })
          .filter((item): item is string => item !== undefined);
        continue;
      }

      target[key] = JSON.stringify(value);
    }

    return target;
  }

  private sanitizeResourceAttributes(
    source: Record<string, unknown>,
  ): DetectedResourceAttributes {
    return this.sanitizeAttributes(source) as DetectedResourceAttributes;
  }
}

export const spanIngestionService = new SpanIngestionService(
  spanIngestionWriteProducer,
);
