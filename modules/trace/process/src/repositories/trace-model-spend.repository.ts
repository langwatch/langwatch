import type {
  TraceDailySpend,
  TraceModelRequests,
  TraceModelSpend,
  TraceModelSpendWindow,
  TraceSpendSummary,
} from "@langwatch/trace-contract";

/** Spend over one tenant's trace summaries in a window, deduped per trace. */
export abstract class TraceModelSpendRepository {
  abstract findModelSpend(input: {
    tenantId: string;
    window: TraceModelSpendWindow;
    limit: number;
  }): Promise<TraceModelSpend[]>;
  abstract getSpendSummary(input: {
    tenantId: string;
    window: TraceModelSpendWindow;
  }): Promise<TraceSpendSummary>;
  abstract findTopModelsByRequests(input: {
    tenantId: string;
    window: TraceModelSpendWindow;
    limit: number;
  }): Promise<TraceModelRequests[]>;
  abstract findDailySpend(input: {
    tenantId: string;
    window: TraceModelSpendWindow;
  }): Promise<TraceDailySpend[]>;
}
