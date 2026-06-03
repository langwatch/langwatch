import { SpanKind as ApiSpanKind } from "@opentelemetry/api";
import type { IExportMetricsServiceRequest } from "@opentelemetry/otlp-transformer";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger/server";
import type { DeepPartial } from "~/utils/types";
import {
  type MetricType,
  piiRedactionLevelSchema,
  type RecordMetricCommandData,
} from "../../event-sourcing/pipelines/trace-processing/schemas/commands";
import {
  normalizeOtlpAttributeMap,
  TraceRequestUtils,
} from "../../event-sourcing/pipelines/trace-processing/utils/traceRequest.utils";
import { decodeBase64OpenTelemetryId } from "../../tracer/utils";
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

  async handleOtlpMetricRequest({
    tenantId,
    metricRequest,
    piiRedactionLevel,
  }: {
    tenantId: string;
    metricRequest: DeepPartial<IExportMetricsServiceRequest>;
    piiRedactionLevel: string;
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

          const resourceAttrs = normalizeOtlpAttributeMap(
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
                results = extractDataPoints({
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
                // OTLP metric data points have no trace context unless
                // emitted inside an active span. Most exporters (incl.
                // Claude Code with OTEL_METRICS_EXPORTER=otlp) emit
                // standalone metrics. Dropping on missing IDs eats
                // legitimate telemetry silently — see the matching note
                // in LogRequestCollectionService.
                const traceId = dp.traceId ?? "";
                const spanId = dp.spanId ?? "";

                try {
                  await this.deps.recordMetric({
                    tenantId,
                    traceId,
                    spanId,
                    metricName,
                    metricUnit,
                    metricType: dp.metricType,
                    value: dp.value,
                    timeUnixMs: dp.timeUnixMs,
                    attributes: dp.attributes,
                    resourceAttributes: resourceAttrs,
                    piiRedactionLevel:
                      piiRedactionLevelSchema.parse(piiRedactionLevel),
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
                      traceId,
                      spanId,
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
}

/**
 * Extracts data points from an OTLP metric.
 * Defined as a module-level function (not a class method) to avoid
 * being wrapped by the `traced()` proxy, which would turn this
 * synchronous function into an async one.
 */
function extractDataPoints({
  metric,
}: {
  metric: Record<string, unknown>;
  metricName: string;
  metricUnit: string;
  resourceAttrs: Record<string, string>;
}): Array<{
  traceId: string | null;
  spanId: string | null;
  metricType: MetricType;
  value: number;
  timeUnixMs: number;
  attributes: Record<string, string>;
}> {
  const results: Array<{
    traceId: string | null;
    spanId: string | null;
    metricType: MetricType;
    value: number;
    timeUnixMs: number;
    attributes: Record<string, string>;
  }> = [];

  // Histogram data points. Two paths:
  //   - When the emitter recorded the histogram inside an active span,
  //     exemplars carry the trace correlation; emit one trace-correlated
  //     row per exemplar.
  //   - Otherwise (the common standalone-exporter case), still keep the
  //     data point: emit a single trace-less row using the dp's sum or
  //     count as the value so the histogram bucket isn't silently lost.
  const histogram = metric.histogram as
    | { dataPoints?: Array<Record<string, unknown>> }
    | undefined;
  if (histogram?.dataPoints) {
    for (const dp of histogram.dataPoints) {
      const dpAttrs = normalizeOtlpAttributeMap(dp?.attributes);
      const exemplars = dp?.exemplars as
        | Array<Record<string, unknown>>
        | undefined;

      if (exemplars?.length) {
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
        continue;
      }

      // Exemplar-less histogram. Prefer sum for a meaningful scalar;
      // fall back to count when only the count is present.
      const sumVal =
        typeof dp?.sum === "number"
          ? (dp.sum as number)
          : typeof dp?.count === "number"
            ? (dp.count as number)
            : typeof dp?.count === "string"
              ? Number(dp.count)
              : 0;
      const timeUnixMs = dp?.timeUnixNano
        ? TraceRequestUtils.convertUnixNanoToUnixMs(
            TraceRequestUtils.normalizeOtlpUnixNano(
              dp.timeUnixNano as
                | string
                | number
                | { low: number; high: number },
            ),
          )
        : Date.now();

      results.push({
        traceId: null,
        spanId: null,
        metricType: "histogram",
        value: Number.isFinite(sumVal) ? sumVal : 0,
        timeUnixMs,
        attributes: dpAttrs,
      });
    }
  }

  // Gauge data points
  const gauge = metric.gauge as
    | { dataPoints?: Array<Record<string, unknown>> }
    | undefined;
  if (gauge?.dataPoints) {
    for (const dp of gauge.dataPoints) {
      const extracted = extractSimpleDataPoint({
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
      const extracted = extractSimpleDataPoint({
        dp,
        metricType: "sum",
      });
      if (extracted) results.push(extracted);
    }
  }

  return results;
}

function extractSimpleDataPoint({
  dp,
  metricType,
}: {
  dp: Record<string, unknown> | undefined;
  metricType: MetricType;
}): {
  traceId: string | null;
  spanId: string | null;
  metricType: MetricType;
  value: number;
  timeUnixMs: number;
  attributes: Record<string, string>;
} | null {
  if (!dp) return null;

  // Trace context on a metric data point comes from exemplars when the
  // emitter recorded the metric inside an active span. Most standalone
  // metric exporters (incl. Claude Code's OTEL_METRICS_EXPORTER) emit
  // gauges/sums with no exemplars. Returning null in that case eats the
  // data point entirely; the value, timestamp and attributes are still
  // meaningful telemetry without a correlated span.
  const exemplars = dp.exemplars as Array<Record<string, unknown>> | undefined;
  let traceId: string | null = null;
  let spanId: string | null = null;
  if (exemplars?.length) {
    for (const exemplar of exemplars) {
      if (!exemplar) continue;
      const exTrace = decodeBase64OpenTelemetryId(exemplar.traceId);
      const exSpan = decodeBase64OpenTelemetryId(exemplar.spanId);
      if (exTrace && exSpan) {
        traceId = exTrace;
        spanId = exSpan;
        break;
      }
    }
  }

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
    attributes: normalizeOtlpAttributeMap(dp.attributes),
  };
}
