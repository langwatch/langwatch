import type { Instant } from "@langwatch/time";

export type AnomalySpendSourceFilter =
  | { type: "all" }
  | { type: "source"; id: string }
  | { type: "source_type"; id: string };

export abstract class AnomalySpendReaderPort {
  abstract findSpendTotals(input: {
    tenantId: string;
    windowStart: Instant;
    windowEnd: Instant;
    baselineStart: Instant;
    sourceFilter: AnomalySpendSourceFilter;
  }): Promise<{ currentSpend: number; baselineSpend: number }>;
}
