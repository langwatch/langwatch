import type { MetricDataPointPreparation, MetricPiiRedactionLevel } from "@langwatch/metric-contract";
export interface MetricInfrastructure {  metricPreparation: MetricPreparation;
  metricRedaction: MetricRedaction;
}

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

/** Private redaction dependency for metric preparation. */
export interface MetricRedaction {
  redactMetricAttributes(
    input: {
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
      attributeNames?: Record<string, string>;
    },
    level: MetricPiiRedactionLevel,
    tenantId?: string,
  ): Promise<void>;
}
