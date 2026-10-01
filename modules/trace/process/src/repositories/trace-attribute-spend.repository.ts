import type {
  TraceAttributedTrace,
  TraceAttributeUsageBucket,
  TraceAttributeValueSpend,
  TraceModelSpendWindow,
} from "@langwatch/trace-contract";

/** One tenant's trace summaries in a window, grouped by the value one attribute holds. */
export abstract class TraceAttributeSpendRepository {
  abstract findSpendByAttributeValue(input: {
    tenantId: string;
    attributeKey: string;
    values: string[];
    window: TraceModelSpendWindow;
  }): Promise<TraceAttributeValueSpend[]>;
  abstract findAttributeUsageBuckets(input: {
    tenantId: string;
    attributeKey: string;
    window: TraceModelSpendWindow;
    values?: string[];
  }): Promise<TraceAttributeUsageBucket[]>;
  abstract findAttributedTraces(input: {
    tenantId: string;
    attributeKey: string;
    window: TraceModelSpendWindow;
    values?: string[];
    model?: string;
    limit: number;
  }): Promise<TraceAttributedTrace[]>;
}
