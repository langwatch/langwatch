import type {
  CanonicalMetricDataPoint,
  MetricApi,
  MetricDataPointPreparation,
  MetricPiiRedactionLevel,
  MetricRequestCollectionResult,
} from "@langwatch/metric-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";
import { SpanKind as ApiSpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

export interface MetricRequestCollectionDeps {
  /** Trace's share of a metric: the exemplar correlations it folds. */
  traces: Pick<TraceApi, "recordMetricCorrelations">;
  /** Only the preparation half of `MetricApi`: this collector sends its own batch, itself. */
  metrics: Pick<MetricApi, "prepareMetricDataPoints">;
  recordDataPoints: (data: CanonicalMetricDataPoint[]) => Promise<void>;
}

/** Returned in place of a persistence exception, which may name internals. */
const PERSISTENCE_ERROR_MESSAGE = "failed to record data point";

/**
 * Converts an OTLP request into immutable canonical data-point events. A bad
 * point is isolated from its siblings so the caller can return OTLP partial
 * success without losing the accepted points.
 */
export class MetricRequestCollectionService {
  private readonly tracer = getLangWatchTracer("langwatch.metric-processing.metric-ingestion");
  private readonly logger = createLogger("langwatch:metric-processing:metric-ingestion");
  private constructor(private readonly deps: MetricRequestCollectionDeps) {}

  static create(deps: MetricRequestCollectionDeps): MetricRequestCollectionService {
    return new MetricRequestCollectionService(deps);
  }

  async handleOtlpMetricRequest({
    tenantId,
    organizationId,
    metricRequest,
    piiRedactionLevel,
  }: {
    tenantId: string;
    organizationId: string;
    metricRequest: unknown;
    piiRedactionLevel: MetricPiiRedactionLevel;
  }): Promise<MetricRequestCollectionResult> {
    return this.tracer.withActiveSpan(
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
          resource_metric_count: countResourceMetrics(metricRequest),
        },
      },
      async (span): Promise<MetricRequestCollectionResult> => {
        const acceptedAt = nowInstant().epochMilliseconds;
        const preparation: MetricDataPointPreparation =
          await this.deps.metrics.prepareMetricDataPoints({
            tenantId,
            organizationId,
            request: metricRequest,
            piiRedactionLevel,
            acceptedAt,
          });

        const acceptedDataPoints = preparation.accepted.length;
        const rejectedDataPoints = preparation.rejectedDataPoints;
        const errors = [...preparation.errors];

        if (!(await this.persistDataPoints({ tenantId, preparation }))) {
          span.setAttribute("metrics.ingestion.unavailable", preparation.accepted.length);

          return { outcome: "unavailable", errorMessage: PERSISTENCE_ERROR_MESSAGE };
        }

        await this.persistCorrelations({ tenantId, preparation });

        span.setAttribute("metrics.ingestion.successes", acceptedDataPoints);
        span.setAttribute("metrics.ingestion.failures", rejectedDataPoints);

        const errorMessage = errors.length ? errors.join("; ").slice(0, 1024) : undefined;

        return {
          outcome: "collected",
          acceptedDataPoints,
          rejectedDataPoints,
          ...(errorMessage ? { errorMessage } : {}),
        };
      },
    );
  }

  /**
   * Enqueues the canonical data points, reporting whether they landed. Preparation errors
   * describe the caller's own payload and are safe to return; a persistence failure is ours,
   * so its message — which can name internal hosts, tables and queries — goes to the log only.
   */
  private async persistDataPoints({
    tenantId,
    preparation,
  }: {
    tenantId: string;
    preparation: MetricDataPointPreparation;
  }): Promise<boolean> {
    if (preparation.accepted.length === 0) {
      return true;
    }

    try {
      await this.deps.recordDataPoints(preparation.accepted.map(({ dataPoint }) => dataPoint));

      return true;
    } catch (error) {
      this.logger.error(
        {
          error,
          tenantId,
          pointCount: preparation.accepted.length,
          pointIds: preparation.accepted.slice(0, 10).map(({ dataPoint }) => dataPoint.pointId),
        },
        "Failed to enqueue canonical metric data point batch",
      );

      return false;
    }
  }

  /**
   * Correlation is deliberately best-effort and separate from metric acceptance. A valid
   * metric remains accepted if a trace fold is temporarily unavailable.
   */
  private async persistCorrelations({
    tenantId,
    preparation,
  }: {
    tenantId: string;
    preparation: MetricDataPointPreparation;
  }): Promise<void> {
    const correlations = preparation.accepted.flatMap(
      ({ correlations: entryCorrelations }) => entryCorrelations,
    );
    if (correlations.length === 0) {
      return;
    }

    try {
      await this.deps.traces.recordMetricCorrelations(correlations);
    } catch (error) {
      this.logger.error(
        {
          error,
          tenantId,
          correlationCount: correlations.length,
          pointIds: correlations.slice(0, 10).map(({ pointId }) => pointId),
        },
        "Failed to enqueue metric exemplar correlation batch",
      );
    }
  }
}

function countResourceMetrics(request: unknown): number {
  if (typeof request !== "object" || request === null || !("resourceMetrics" in request)) return 0;
  return Array.isArray(request.resourceMetrics) ? request.resourceMetrics.length : 0;
}
