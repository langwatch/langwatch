import type { DeepPartial } from "~/utils/types";
import type { IExportMetricsServiceRequest } from "@opentelemetry/otlp-transformer";
import { createLogger } from "~/utils/logger";
import {
  otelAttributesToNestedAttributes,
  type TraceForCollection,
} from "./otel.traces";
import { decodeBase64OpenTelemetryId, convertFromUnixNano } from "./utils";
import { getLangWatchTracer } from "langwatch";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";

const logger = createLogger("langwatch.tracer.otel.metrics");
const tracer = getLangWatchTracer("langwatch.tracer.otel.metrics");

// Supported GenAI metrics we want to extract
const GENAI_METRICS = {
  TIME_TO_FIRST_TOKEN: "gen_ai.server.time_to_first_token",
  REQUEST_DURATION: "gen_ai.server.request.duration",
  TIME_PER_OUTPUT_TOKEN: "gen_ai.server.time_per_output_token",
} as const;

export const openTelemetryMetricsRequestToTracesForCollection = async (
  otelMetrics: DeepPartial<IExportMetricsServiceRequest>
): Promise<TraceForCollection[]> => {
  console.log("otelMetrics", JSON.stringify(otelMetrics, undefined, 2));
  return await tracer.withActiveSpan(
    "openTelemetryMetricsRequestToTracesForCollection",
    { kind: SpanKind.INTERNAL },
    async (span) => {
      try {
        if (!otelMetrics.resourceMetrics) {
          span.setAttribute("resourceMetrics.count", 0);
          return [];
        }

        span.setAttribute(
          "resourceMetrics.count",
          otelMetrics.resourceMetrics.length
        );

        const traceMap: Record<string, TraceForCollection> = {};

        for (const resourceMetric of otelMetrics.resourceMetrics) {
          if (!resourceMetric?.scopeMetrics) {
            continue;
          }

          for (const scopeMetric of resourceMetric.scopeMetrics) {
            if (!scopeMetric?.metrics) {
              continue;
            }

            for (const metric of scopeMetric.metrics) {
              if (!metric) {
                continue;
              }

              // Process histogram metrics
              if (metric.histogram?.dataPoints) {
                for (const dataPoint of metric.histogram.dataPoints) {
                  if (!dataPoint?.exemplars) {
                    continue;
                  }

                  for (const exemplar of dataPoint.exemplars) {
                    if (!exemplar) {
                      continue;
                    }

                    const traceId = decodeBase64OpenTelemetryId(exemplar.traceId);
                    const spanId = decodeBase64OpenTelemetryId(exemplar.spanId);

                    if (!traceId || !spanId) {
                      logger.info(
                        "received metric exemplar with no span or trace id, rejecting"
                      );
                      continue;
                    }

                    let trace = traceMap[traceId];
                    if (!trace) {
                      trace = {
                        traceId,
                        spans: [],
                        evaluations: [],
                        reservedTraceMetadata: {},
                        customMetadata: {},
                      } satisfies TraceForCollection;
                      traceMap[traceId] = trace;
                    }

                    let existingSpan = trace.spans.find(
                      (span) => span.span_id === spanId
                    );

                    const exemplarTime = convertFromUnixNano(
                      exemplar.timeUnixNano
                    );

                    if (!existingSpan) {
                      existingSpan = {
                        span_id: spanId,
                        trace_id: traceId,
                        type: "llm",
                        params: {},
                        timestamps: {
                          ignore_timestamps_on_write: true,
                          started_at: exemplarTime,
                          finished_at: exemplarTime,
                        },
                      };
                      trace.spans.push(existingSpan);
                    }

                    // Map specific GenAI metrics to span fields
                    if (metric.name === GENAI_METRICS.TIME_TO_FIRST_TOKEN) {
                      const firstTokenMs = convertSecondsToMilliseconds(
                        exemplar.asDouble ?? exemplar.asInt
                      );

                      if (firstTokenMs !== null) {
                        // Set first_token_at based on the exemplar time
                        existingSpan.timestamps.first_token_at = exemplarTime;
                      }
                    }

                    // Store all metric attributes generically in params
                    if (
                      dataPoint.attributes &&
                      dataPoint.attributes.length > 0
                    ) {
                      if (!existingSpan.params) {
                        existingSpan.params = {};
                      }
                      if (!existingSpan.params.metrics) {
                        existingSpan.params.metrics = {};
                      }

                      const metricKey = metric.name ?? "unknown";
                      (existingSpan.params.metrics as Record<string, any>)[
                        metricKey
                      ] = {
                        ...otelAttributesToNestedAttributes(
                          dataPoint.attributes
                        ),
                        value: exemplar.asDouble ?? exemplar.asInt,
                        unit: metric.unit,
                        timestamp: exemplarTime,
                      };
                    }
                  }
                }
              }

              // Process gauge metrics
              if (metric.gauge?.dataPoints) {
                for (const dataPoint of metric.gauge.dataPoints) {
                  if (!dataPoint?.exemplars) {
                    continue;
                  }

                  for (const exemplar of dataPoint.exemplars) {
                    if (!exemplar) {
                      continue;
                    }

                    const traceId = decodeBase64OpenTelemetryId(exemplar.traceId);
                    const spanId = decodeBase64OpenTelemetryId(exemplar.spanId);

                    if (!traceId || !spanId) {
                      continue;
                    }

                    let trace = traceMap[traceId];
                    if (!trace) {
                      trace = {
                        traceId,
                        spans: [],
                        evaluations: [],
                        reservedTraceMetadata: {},
                        customMetadata: {},
                      } satisfies TraceForCollection;
                      traceMap[traceId] = trace;
                    }

                    const exemplarTime = convertFromUnixNano(
                      exemplar.timeUnixNano
                    );

                    let existingSpan = trace.spans.find(
                      (span) => span.span_id === spanId
                    );

                    if (!existingSpan) {
                      existingSpan = {
                        span_id: spanId,
                        trace_id: traceId,
                        type: "llm",
                        params: {},
                        timestamps: {
                          ignore_timestamps_on_write: true,
                          started_at: exemplarTime,
                          finished_at: exemplarTime,
                        },
                      };
                      trace.spans.push(existingSpan);
                    }

                    // Store gauge metrics in params
                    if (!existingSpan.params) {
                      existingSpan.params = {};
                    }
                    if (!existingSpan.params.metrics) {
                      existingSpan.params.metrics = {};
                    }

                    const metricKey = metric.name ?? "unknown";
                    (existingSpan.params.metrics as Record<string, any>)[
                      metricKey
                    ] = {
                      ...(dataPoint.attributes
                        ? otelAttributesToNestedAttributes(dataPoint.attributes)
                        : {}),
                      value: exemplar.asDouble ?? exemplar.asInt,
                      unit: metric.unit,
                      timestamp: exemplarTime,
                    };
                  }
                }
              }

              // Process sum metrics
              if (metric.sum?.dataPoints) {
                for (const dataPoint of metric.sum.dataPoints) {
                  if (!dataPoint?.exemplars) {
                    continue;
                  }

                  for (const exemplar of dataPoint.exemplars) {
                    if (!exemplar) {
                      continue;
                    }

                    const traceId = decodeBase64OpenTelemetryId(exemplar.traceId);
                    const spanId = decodeBase64OpenTelemetryId(exemplar.spanId);

                    if (!traceId || !spanId) {
                      continue;
                    }

                    let trace = traceMap[traceId];
                    if (!trace) {
                      trace = {
                        traceId,
                        spans: [],
                        evaluations: [],
                        reservedTraceMetadata: {},
                        customMetadata: {},
                      } satisfies TraceForCollection;
                      traceMap[traceId] = trace;
                    }

                    const exemplarTime = convertFromUnixNano(
                      exemplar.timeUnixNano
                    );

                    let existingSpan = trace.spans.find(
                      (span) => span.span_id === spanId
                    );

                    if (!existingSpan) {
                      existingSpan = {
                        span_id: spanId,
                        trace_id: traceId,
                        type: "llm",
                        params: {},
                        timestamps: {
                          ignore_timestamps_on_write: true,
                          started_at: exemplarTime,
                          finished_at: exemplarTime,
                        },
                      };
                      trace.spans.push(existingSpan);
                    }

                    // Store sum metrics in params
                    if (!existingSpan.params) {
                      existingSpan.params = {};
                    }
                    if (!existingSpan.params.metrics) {
                      existingSpan.params.metrics = {};
                    }

                    const metricKey = metric.name ?? "unknown";
                    (existingSpan.params.metrics as Record<string, any>)[
                      metricKey
                    ] = {
                      ...(dataPoint.attributes
                        ? otelAttributesToNestedAttributes(dataPoint.attributes)
                        : {}),
                      value: exemplar.asDouble ?? exemplar.asInt,
                      unit: metric.unit,
                      timestamp: exemplarTime,
                    };
                  }
                }
              }
            }
          }
        }

        const result = Object.values(traceMap);
        span.setAttribute("processed.traces.count", result.length);
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        span.recordException(
          error instanceof Error ? error : new Error(String(error))
        );
        throw error;
      }
    }
  );
};

const convertSecondsToMilliseconds = (seconds: unknown): number | null => {
  if (typeof seconds === "number") {
    return Math.round(seconds * 1000);
  }
  if (typeof seconds === "string") {
    const parsed = parseFloat(seconds);
    return !isNaN(parsed) ? Math.round(parsed * 1000) : null;
  }
  return null;
};
