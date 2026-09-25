import type { TraceModelSpend, TraceModelSpendWindow } from "@langwatch/trace-contract";

/** Spend per model over one tenant's trace summaries, most spent first. */
export abstract class TraceModelSpendRepository {
  abstract findModelSpend(input: {
    tenantId: string;
    window: TraceModelSpendWindow;
    limit: number;
  }): Promise<TraceModelSpend[]>;
}
