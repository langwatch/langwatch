import { createLogger } from "@langwatch/observability";
import { SpanKind as ApiSpanKind } from "@opentelemetry/api";
import type { IExportMetricsServiceRequest } from "@opentelemetry/otlp-transformer";
import { getLangWatchTracer } from "langwatch";
import type { DeepPartial } from "~/utils/types";
import {
  type MetricPreparationResult,
  prepareMetricDataPoints,
} from "../../event-sourcing/pipelines/metric-processing/canonicalMetric";
import type { CanonicalMetricDataPoint } from "../../event-sourcing/pipelines/metric-processing/schemas/metricDataPoint";
import {
  piiRedactionLevelSchema,
  type RecordMetricCorrelationCommandData,
} from "../../event-sourcing/pipelines/trace-processing/schemas/commands";
import { OtlpSpanPiiRedactionService } from "./span-pii-redaction.service";

export interface MetricRequestCollectionDeps {
  recordDataPoints: (data: CanonicalMetricDataPoint[]) => Promise<void>;
  recordMetricCorrelations: (
    data: RecordMetricCorrelationCommandData[],
  ) => Promise<void>;
  piiRedactionService?: Pick<
    OtlpSpanPiiRedactionService,
    "redactMetricAttributes"
  >;
}

/**
 * The outcome of an OTLP metric request.
 *
 * The two cases are deliberately separate shapes rather than a counter pair.
 * An OTLP `partialSuccess` body means the server rejected those points
 * *permanently* and the client must not re-send them, so folding a failure
 * that is ours — a queue outage, say — into `rejectedDataPoints` tells every
 * collector in the fleet to drop data it would otherwise have retried. As a
 * counter pair the two are one indistinguishable `+= n`; as a discriminated
 * union, conflating them is a type error at the call site.
 */
export type MetricRequestCollectionResult =
  | {
      outcome: "collected";
      acceptedDataPoints: number;
      /** Rejected for good — the caller must NOT retry these. */
      rejectedDataPoints: number;
      errorMessage?: string;
    }
  | {
      /**
       * Nothing was durably accepted. `recordDataPoints` enqueues the batch in
       * one call, so this is all-or-nothing: the caller must retry the whole
       * request, and the route must answer with a retryable status.
       */
      outcome: "unavailable";
      errorMessage: string;
    };

/** Returned in place of a persistence exception, which may name internals. */
const PERSISTENCE_ERROR_MESSAGE = "failed to record data point";

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
          // Intentional: both ids are opaque internal KSUIDs, and metric usage
          // is metered per organization while ingestion for an ingestion-key
          // source lands in a hidden governance project — without the
          // organization id an operator cannot tie a metric span to the
          // account it bills to. Neither id carries end-user data.
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

        const acceptedDataPoints = preparation.accepted.length;
        const rejectedDataPoints = preparation.rejectedDataPoints;
        const errors = [...preparation.errors];

        if (preparation.accepted.length > 0) {
          try {
            await this.deps.recordDataPoints(
              preparation.accepted.map(({ dataPoint }) => dataPoint),
            );
          } catch (error) {
            // Preparation errors describe the caller's own payload and are
            // safe to return. A persistence failure is ours: its message can
            // name internal hosts, tables and queries, so the sender gets a
            // stable string and the detail goes to the log only.
            span.setAttribute(
              "metrics.ingestion.unavailable",
              preparation.accepted.length,
            );
            this.logger.error(
              {
                error,
                tenantId,
                pointCount: preparation.accepted.length,
                pointIds: preparation.accepted
                  .slice(0, 10)
                  .map(({ dataPoint }) => dataPoint.pointId),
              },
              "Failed to enqueue canonical metric data point batch",
            );
            return {
              outcome: "unavailable",
              errorMessage: PERSISTENCE_ERROR_MESSAGE,
            };
          }
        }

        if (acceptedDataPoints > 0) {
          // Correlation is deliberately best-effort and separate from metric
          // acceptance. A valid metric remains accepted if a trace fold is
          // temporarily unavailable.
          const correlations = preparation.accepted.flatMap(
            ({ correlations }) => correlations,
          );
          if (correlations.length > 0) {
            try {
              await this.deps.recordMetricCorrelations(correlations);
            } catch (error) {
              this.logger.error(
                {
                  error,
                  tenantId,
                  correlationCount: correlations.length,
                  pointIds: correlations
                    .slice(0, 10)
                    .map(({ pointId }) => pointId),
                },
                "Failed to enqueue metric exemplar correlation batch",
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
          outcome: "collected",
          acceptedDataPoints,
          rejectedDataPoints,
          ...(errorMessage ? { errorMessage } : {}),
        };
      },
    );
  }
}
