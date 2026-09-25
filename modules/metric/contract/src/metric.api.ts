import { moduleApi } from "@langwatch/kernel/module-api";
import type { OtlpDoorRefusal, OtlpDoorRequest } from "@langwatch/otlp";
import { z } from "zod";

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

/** What `POST /api/otel/v1/metrics` answers from: the collection, or the door's own refusal. */
export type MetricOtlpDoorResult = MetricRequestCollectionResult | OtlpDoorRefusal;

/** The exporter base a `/v1/metrics` suffix was appended to; the receiver checks it. */
export const otlpMetricAliasParamsSchema = z.object({ otlpBase: z.string() });

export interface MetricApi {
  prepareMetricDataPoints(input: {
    tenantId: string;
    organizationId: string;
    request: unknown;
    piiRedactionLevel: MetricPiiRedactionLevel;
    acceptedAt?: number;
  }): Promise<MetricDataPointPreparation>;
  /** One exporter request at the metrics door: key, allowance, parse, then collection. */
  receiveOtlpMetrics(request: OtlpDoorRequest): Promise<MetricOtlpDoorResult>;
  /** Sends prepared points onto the `metric_processing` pipeline for durable storage. */
  recordCanonicalMetricDataPoints(points: readonly CanonicalMetricDataPoint[]): Promise<void>;
}

export const MetricApi = moduleApi<MetricApi>()("metric");
