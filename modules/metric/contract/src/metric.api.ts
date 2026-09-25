import { moduleApi } from "@langwatch/kernel/module-api";

import type {
  CanonicalMetricDataPoint,
  MetricTraceCorrelation,
} from "./schemas/metric-processing/metric-data-point.ts";

export type MetricPiiRedactionLevel = "STRICT" | "ESSENTIAL" | "DISABLED";

export type PreparedMetricDataPoint = {
  dataPoint: CanonicalMetricDataPoint;
  correlations: MetricTraceCorrelation[];
};

export type MetricDataPointPreparation = {
  accepted: PreparedMetricDataPoint[];
  rejectedDataPoints: number;
  errors: string[];
};

/** Callable metric preparation capability shared by ingestion transports. */
/**
 * An OTLP metric request's outcome. `unavailable` means nothing was durably accepted, so the
 * sender retries the whole request; `rejectedDataPoints` are refused for good.
 */
export type MetricRequestCollectionResult =
  | {
      outcome: "collected";
      acceptedDataPoints: number;
      rejectedDataPoints: number;
      errorMessage?: string;
    }
  | { outcome: "unavailable"; errorMessage: string };

export interface MetricApi {
  prepareMetricDataPoints(input: {
    tenantId: string;
    organizationId: string;
    request: unknown;
    piiRedactionLevel: MetricPiiRedactionLevel;
    acceptedAt?: number;
  }): Promise<MetricDataPointPreparation>;
  /** Sends prepared points onto the `metric_processing` pipeline for durable storage. */
  /** Prepares, records and correlates one OTLP metric request (main's MetricRequestCollection). */
  handleOtlpMetricRequest(input: {
    tenantId: string;
    organizationId: string;
    metricRequest: unknown;
    piiRedactionLevel: MetricPiiRedactionLevel;
  }): Promise<MetricRequestCollectionResult>;
  recordCanonicalMetricDataPoints(points: readonly CanonicalMetricDataPoint[]): Promise<void>;
}

export const MetricApi = moduleApi<MetricApi>()("metric");
