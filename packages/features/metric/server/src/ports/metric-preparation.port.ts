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

export abstract class MetricPreparationPort {
  abstract prepare(input: MetricPreparationInput): Promise<MetricDataPointPreparation>;
}
