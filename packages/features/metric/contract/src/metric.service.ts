import type {
  CanonicalMetricDataPoint,
  MetricTraceCorrelation,
} from "./schemas/metric-processing/metric-data-point";

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

/** The ordinary-caller boundary for canonical metric preparation. */
export abstract class MetricService {
  abstract prepareMetricDataPoints(input: {
    tenantId: string;
    organizationId: string;
    request: unknown;
    piiRedactionLevel: MetricPiiRedactionLevel;
    acceptedAt?: number;
  }): Promise<MetricDataPointPreparation>;
}
