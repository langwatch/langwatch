import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import {
  MetricApi,
  type MetricApi as MetricApiContract,
  type MetricDataPointPreparation,
  type MetricPiiRedactionLevel,
} from "@langwatch/metric-contract";

import { CanonicalMetricService } from "../services/canonical-metric.service.ts";
import { MetricService } from "../services/metric.service.ts";

type MetricDependencies = Readonly<{ dataPrivacy: typeof DataPrivacyApi }>;
type MetricSetup = FeatureSetup<MetricDependencies, never, undefined>;

/** The process-owned metric preparation capability. */
export class MetricApp implements MetricApiContract {
  static readonly contract = MetricApi;
  static readonly dependencies: MetricDependencies = { dataPrivacy: DataPrivacyApi };

  readonly #service: MetricService;

  private constructor(service: MetricService) {
    this.#service = service;
  }

  static create({ dependencies }: MetricSetup): MetricApp {
    const preparation = CanonicalMetricService.create({ redaction: dependencies.dataPrivacy });
    return new MetricApp(MetricService.create({ preparation }));
  }

  prepareMetricDataPoints(input: {
    tenantId: string;
    organizationId: string;
    request: unknown;
    piiRedactionLevel: MetricPiiRedactionLevel;
    acceptedAt?: number;
  }): Promise<MetricDataPointPreparation> {
    return this.#service.prepareMetricDataPoints(input);
  }
}
