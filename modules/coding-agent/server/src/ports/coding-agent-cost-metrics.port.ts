export type CodingAgentCostMetric = {
  eventId: string;
  agent: string;
  model: string;
  valueUsd: number;
};

export abstract class CodingAgentCostMetricsPort {
  abstract recordComputed(input: CodingAgentCostMetric): void;
  abstract recordReported(input: CodingAgentCostMetric): void;
}
