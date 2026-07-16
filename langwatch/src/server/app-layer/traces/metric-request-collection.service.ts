import { createLogger } from "@langwatch/observability";
import { SpanKind as ApiSpanKind } from "@opentelemetry/api";
import type { IExportMetricsServiceRequest } from "@opentelemetry/otlp-transformer";
import { getLangWatchTracer } from "langwatch";
import type { DeepPartial } from "~/utils/types";
import {
  prepareMetricDataPoints,
  type MetricPreparationResult,
} from "../../event-sourcing/pipelines/metric-processing/canonicalMetric";
import type { CanonicalMetricDataPoint } from "../../event-sourcing/pipelines/metric-processing/schemas/metricDataPoint";
import {
  piiRedactionLevelSchema,
  type RecordMetricCorrelationCommandData,
} from "../../event-sourcing/pipelines/trace-processing/schemas/commands";
import { OtlpSpanPiiRedactionService } from "./span-pii-redaction.service";

export interface MetricRequestCollectionDeps {
  recordDataPoint: (data: CanonicalMetricDataPoint) => Promise<void>;
  recordMetricCorrelation: (
    data: RecordMetricCorrelationCommandData,
  ) => Promise<void>;
  piiRedactionService?: Pick<
    OtlpSpanPiiRedactionService,
    "redactMetricAttributes"
  >;
}

export interface MetricRequestCollectionResult {
  acceptedDataPoints: number;
  rejectedDataPoints: number;
  errorMessage?: string;
}

/**
 * Converts an OTLP request into immutable canonical data-point events. A bad
 * point is isolated from its siblings so the caller can return OTLP partial
 * success without losing the accepted points.
 */
export class MetricRequestCollectionService {
  private readonly tracer = getLangWatchTracer(
    "langwatch.metric-processing.metric-ingestion",
  );
  private readonly logger = createLogger(
    "langwatch:metric-processing:metric-ingestion",
  );
  private readonly piiRedactionService: Pick<
    OtlpSpanPiiRedactionService,
    "redactMetricAttributes"
  >;

  constructor(private readonly deps: MetricRequestCollectionDeps) {
    this.piiRedactionService =
      deps.piiRedactionService ?? new OtlpSpanPiiRedactionService();
  }

  async handleOtlpMetricRequest({
    tenantId,
    organizationId,
    metricRequest,
    piiRedactionLevel,
  }: {
    tenantId: string;
    organizationId: string;
    metricRequest: DeepPartial<IExportMetricsServiceRequest>;
    piiRedactionLevel: string;
  }): Promise<MetricRequestCollectionResult> {
    return await this.tracer.withActiveSpan(
      "MetricRequestCollectionService.handleOtlpMetricRequest",
      {
        kind: ApiSpanKind.PRODUCER,
        attributes: {
          "tenant.id": tenantId,
          "organization.id": organizationId,
          resource_metric_count: metricRequest.resourceMetrics?.length ?? 0,
        },
      },
      async (span) => {
        const acceptedAt = Date.now();
        const preparation: MetricPreparationResult =
          await prepareMetricDataPoints({
            tenantId,
            organizationId,
            request: metricRequest,
            piiRedactionLevel: piiRedactionLevelSchema.parse(piiRedactionLevel),
            redactionService: this.piiRedactionService,
            acceptedAt,
          });

        let acceptedDataPoints = 0;
        let rejectedDataPoints = preparation.rejectedDataPoints;
        const errors = [...preparation.errors];

        for (const prepared of preparation.accepted) {
          try {
            await this.deps.recordDataPoint(prepared.dataPoint);
            acceptedDataPoints++;
          } catch (error) {
            rejectedDataPoints++;
            const message =
              error instanceof Error ? error.message : String(error);
            errors.push(`${prepared.dataPoint.metricName}: ${message}`);
            this.logger.error(
              {
                error,
                tenantId,
                pointId: prepared.dataPoint.pointId,
                metricName: prepared.dataPoint.metricName,
              },
              "Failed to enqueue canonical metric data point",
            );
            continue;
          }

          // Correlation is deliberately best-effort and separate from metric
          // acceptance. A valid metric remains accepted if a trace fold is
          // temporarily unavailable.
          for (const correlation of prepared.correlations) {
            try {
              await this.deps.recordMetricCorrelation(correlation);
            } catch (error) {
              this.logger.error(
                {
                  error,
                  tenantId,
                  pointId: prepared.dataPoint.pointId,
                  traceId: correlation.traceId,
                  spanId: correlation.spanId,
                },
                "Failed to enqueue metric exemplar correlation",
              );
            }
          }
        }

        span.setAttribute("metrics.ingestion.successes", acceptedDataPoints);
        span.setAttribute("metrics.ingestion.failures", rejectedDataPoints);

        const errorMessage = errors.length
          ? errors.join("; ").slice(0, 1024)
          : undefined;
        return {
          acceptedDataPoints,
          rejectedDataPoints,
          ...(errorMessage ? { errorMessage } : {}),
        };
      },
    );
  }
}
