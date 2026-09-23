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
export interface MetricApi {
  prepareMetricDataPoints(input: {
    tenantId: string;
    organizationId: string;
    request: unknown;
    piiRedactionLevel: MetricPiiRedactionLevel;
    acceptedAt?: number;
  }): Promise<MetricDataPointPreparation>;
  /** Sends prepared points onto the `metric_processing` pipeline for durable storage. */
  recordCanonicalMetricDataPoints(points: readonly CanonicalMetricDataPoint[]): Promise<void>;
}

export const MetricApi = moduleApi<MetricApi>()("metric");
