import {
  MetricService as MetricServiceContract,
  type MetricDataPointPreparation,
  type MetricPiiRedactionLevel,
} from "@langwatch/metric-contract";
import { MetricPreparationPort } from "../ports/metric-preparation.port";

/** Concrete process-wide implementation of the metric contract. */
export class MetricService extends MetricServiceContract {
  private constructor(private readonly preparation: MetricPreparationPort) {
    super();
  }

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
