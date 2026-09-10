import type {
  MetricDataPointPreparation,
  MetricPiiRedactionLevel,
} from "@langwatch/metric-contract";
import type { MetricPreparation } from "../app/metric.infrastructure.ts";

/** Canonical preparation for one OTLP metric export request. */
export class MetricService {
  private constructor(private readonly preparation: MetricPreparation) {}

  static create(options: { preparation: MetricPreparation }): MetricService {
    return new MetricService(options.preparation);
  }

  prepareMetricDataPoints(input: {
    tenantId: string;
    organizationId: string;
    request: unknown;
    piiRedactionLevel: MetricPiiRedactionLevel;
    acceptedAt?: number;
  }): Promise<MetricDataPointPreparation> {
    return this.preparation.prepare(input);
  }
}
