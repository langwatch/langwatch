import type {
  MetricDataPointPreparation,
  MetricPiiRedactionLevel,
} from "@langwatch/metric-contract";
import { MetricPreparationPort } from "../ports/metric-preparation.port.ts";

/** Canonical preparation for one OTLP metric export request. */
export class MetricService {
  private constructor(private readonly preparation: MetricPreparationPort) {}

  static create(options: { preparation: MetricPreparationPort }): MetricService {
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
