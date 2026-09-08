import { featureApi } from "@langwatch/runtime-composition";
import type { MetricDataPointPreparation, MetricPiiRedactionLevel } from "./metric.service.ts";

/** Callable metric preparation capability shared by ingestion transports. */
export interface MetricApi {
  prepareMetricDataPoints(input: {
    tenantId: string;
    organizationId: string;
    request: unknown;
    piiRedactionLevel: MetricPiiRedactionLevel;
    acceptedAt?: number;
  }): Promise<MetricDataPointPreparation>;
}

export const MetricApi = featureApi<MetricApi>("metric");
