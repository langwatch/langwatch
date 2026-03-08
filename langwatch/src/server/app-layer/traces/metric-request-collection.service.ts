import { SpanKind as ApiSpanKind } from "@opentelemetry/api";
import type { IExportMetricsServiceRequest } from "@opentelemetry/otlp-transformer";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger/server";
import type { DeepPartial } from "~/utils/types";
import type { RecordMetricCommandData } from "../../event-sourcing/pipelines/trace-processing/schemas/commands";
import { TraceRequestUtils } from "../../event-sourcing/pipelines/trace-processing/utils/traceRequest.utils";
import { decodeBase64OpenTelemetryId } from "../../tracer/utils";
import { traced } from "../tracing";
import { serializeAttributes } from "./repositories/span-storage.clickhouse.repository";

export interface MetricRequestCollectionDeps {
  recordMetric: (data: RecordMetricCommandData) => Promise<void>;
}

export class MetricRequestCollectionService {
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.metric-ingestion",
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:metric-ingestion",
  );

  constructor(private readonly deps: MetricRequestCollectionDeps) {}

  static create(
    deps: MetricRequestCollectionDeps,
  ): MetricRequestCollectionService {
    return traced(
      new MetricRequestCollectionService(deps),
      "MetricRequestCollectionService",
    );
  }

  async handleOtlpMetricRequest({
    tenantId,
    metricRequest,
  }: {
    tenantId: string;
    metricRequest: DeepPartial<IExportMetricsServiceRequest>;
  }): Promise<void> {
    return await this.tracer.withActiveSpan(
      "MetricRequestCollectionService.handleOtlpMetricRequest",
      {
        kind: ApiSpanKind.PRODUCER,
        attributes: {
          "tenant.id": tenantId,
          resource_metric_count: metricRequest.resourceMetrics?.length ?? 0,
        },
      },
      async (span) => {
        let collectedCount = 0;
        let droppedCount = 0;
        let failedCount = 0;

        for (const resourceMetric of metricRequest.resourceMetrics ?? []) {
          if (!resourceMetric?.scopeMetrics) continue;

          const resourceAttrs = this.normalizeResourceAttributes(
            resourceMetric.resource?.attributes,
          );

          for (const scopeMetric of resourceMetric.scopeMetrics) {
            if (!scopeMetric?.metrics) continue;

            for (const metric of scopeMetric.metrics) {
              if (!metric) continue;

              const metricName = (metric.name as string) ?? "";
              const metricUnit = (metric.unit as string) ?? "";

              let results;
              try {
                results = this.extractDataPoints({
                  metric,
                  metricName,
                  metricUnit,
                  resourceAttrs,
                });
              } catch (error) {
                failedCount++;
                this.logger.error(
                  { error, tenantId, metricName },
                  "Error extracting data points for metric",
                );
                continue;
              }

              for (const dp of results) {
                if (!dp.traceId || !dp.spanId) {
                  droppedCount++;
                  continue;
                }

                try {
                  await this.deps.recordMetric({
                    tenantId,
                    traceId: dp.traceId,
                    spanId: dp.spanId,
                    metricName,
                    metricUnit,
                    metricType: dp.metricType,
                    value: dp.value,
                    timeUnixMs: dp.timeUnixMs,
                    attributes: dp.attributes,
                    resourceAttributes: resourceAttrs,
                    occurredAt: Date.now(),
                  });

                  collectedCount++;
                } catch (error) {
                  failedCount++;
                  this.logger.error(
                    {
                      error,
                      tenantId,
                      metricName,
                      traceId: dp.traceId,
                      spanId: dp.spanId,
                    },
                    "Error recording metric data point",
                  );
                }
              }
            }
          }
        }

        span.setAttribute("metrics.ingestion.successes", collectedCount);
        span.setAttribute("metrics.ingestion.drops", droppedCount);
        span.setAttribute("metrics.ingestion.failures", failedCount);
      },
    );
  }

  private extractDataPoints({
    metric,
    metricName,
    metricUnit,
    resourceAttrs,
  }: {
    metric: Record<string, unknown>;
    metricName: string;
    metricUnit: string;
    resourceAttrs: Record<string, string>;
  }): Array<{
    traceId: string | null;
    spanId: string | null;
    metricType: string;
    value: number;
    timeUnixMs: number;
    attributes: Record<string, string>;
  }> {
    const results: Array<{
      traceId: string | null;
      spanId: string | null;
      metricType: string;
      value: number;
      timeUnixMs: number;
      attributes: Record<string, string>;
    }> = [];

    // Histogram data points with exemplars
    const histogram = metric.histogram as
      | { dataPoints?: Array<Record<string, unknown>> }
      | undefined;
    if (histogram?.dataPoints) {
      for (const dp of histogram.dataPoints) {
        const dpAttrs = this.normalizeDataPointAttributes(dp?.attributes);
        const exemplars = dp?.exemplars as
          | Array<Record<string, unknown>>
          | undefined;
        if (!exemplars) continue;

        for (const exemplar of exemplars) {
          if (!exemplar) continue;
          const traceId = decodeBase64OpenTelemetryId(exemplar.traceId);
          const spanId = decodeBase64OpenTelemetryId(exemplar.spanId);
          const value =
            typeof exemplar.asDouble === "number"
              ? exemplar.asDouble
              : typeof exemplar.asInt === "number"
                ? exemplar.asInt
                : 0;
          const timeUnixMs = exemplar.timeUnixNano
            ? TraceRequestUtils.convertUnixNanoToUnixMs(
                TraceRequestUtils.normalizeOtlpUnixNano(
                  exemplar.timeUnixNano as
                    | string
                    | number
                    | { low: number; high: number },
                ),
              )
            : Date.now();

          results.push({
            traceId,
            spanId,
            metricType: "histogram",
            value,
            timeUnixMs,
            attributes: dpAttrs,
          });
        }
      }
    }

    // Gauge data points
    const gauge = metric.gauge as
      | { dataPoints?: Array<Record<string, unknown>> }
      | undefined;
    if (gauge?.dataPoints) {
      for (const dp of gauge.dataPoints) {
        const extracted = this.extractSimpleDataPoint({
          dp,
          metricType: "gauge",
        });
        if (extracted) results.push(extracted);
      }
    }

    // Sum data points
    const sum = metric.sum as
      | { dataPoints?: Array<Record<string, unknown>> }
      | undefined;
    if (sum?.dataPoints) {
      for (const dp of sum.dataPoints) {
        const extracted = this.extractSimpleDataPoint({
          dp,
          metricType: "sum",
        });
        if (extracted) results.push(extracted);
      }
    }

    return results;
  }

  private extractSimpleDataPoint({
    dp,
    metricType,
  }: {
    dp: Record<string, unknown> | undefined;
    metricType: string;
  }): {
    traceId: string | null;
    spanId: string | null;
    metricType: string;
    value: number;
    timeUnixMs: number;
    attributes: Record<string, string>;
  } | null {
    if (!dp) return null;

    // Simple data points may have exemplars with traceId/spanId
    const exemplars = dp.exemplars as
      | Array<Record<string, unknown>>
      | undefined;
    if (exemplars?.length) {
      for (const exemplar of exemplars) {
        if (!exemplar) continue;
        const traceId = decodeBase64OpenTelemetryId(exemplar.traceId);
        const spanId = decodeBase64OpenTelemetryId(exemplar.spanId);
        if (traceId && spanId) {
          const value =
            typeof dp.asDouble === "number"
              ? dp.asDouble
              : typeof dp.asInt === "number"
                ? dp.asInt
                : 0;
          const timeUnixMs = dp.timeUnixNano
            ? TraceRequestUtils.convertUnixNanoToUnixMs(
                TraceRequestUtils.normalizeOtlpUnixNano(
                  dp.timeUnixNano as
                    | string
                    | number
                    | { low: number; high: number },
                ),
              )
            : Date.now();

          return {
            traceId,
            spanId,
            metricType,
            value,
            timeUnixMs,
            attributes: this.normalizeDataPointAttributes(dp.attributes),
          };
        }
      }
    }

    return null;
  }

  private normalizeResourceAttributes(
    attributes: unknown,
  ): Record<string, string> {
    if (!Array.isArray(attributes)) return {};
    const normalized = TraceRequestUtils.normalizeOtlpAttributes(attributes);
    return serializeAttributes(normalized);
  }

  private normalizeDataPointAttributes(
    attributes: unknown,
  ): Record<string, string> {
    if (!Array.isArray(attributes)) return {};
    const normalized = TraceRequestUtils.normalizeOtlpAttributes(attributes);
    return serializeAttributes(normalized);
  }
}
