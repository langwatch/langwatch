import type {
  MetricDataPointPreparation,
  MetricPiiRedactionLevel,
} from "@langwatch/metric-contract";

export type MetricPreparationInput = {
  tenantId: string;
  organizationId: string;
  request: unknown;
  piiRedactionLevel: MetricPiiRedactionLevel;
  acceptedAt?: number;
};

export interface MetricPreparation {
  prepare(input: MetricPreparationInput): Promise<MetricDataPointPreparation>;
}

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
