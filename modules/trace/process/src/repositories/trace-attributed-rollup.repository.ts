import type {
  TraceAttributedRecency,
  TraceAttributedSpendComparison,
  TraceAttributedSpendSort,
  TraceAttributedTraceDetail,
  TraceAttributedValueComparison,
  TraceAttributedValueSpend,
  TraceAttributeMatch,
  TraceDailyGroupSpend,
  TraceDailySpendGroup,
  TraceModelSpendWindow,
  TraceProjectValueSpend,
} from "@langwatch/trace-contract";

/** Rollups over the latest version of each trace matching every attribute in `matches`. */
export abstract class TraceAttributedRollupRepository {
  abstract getAttributedSpendComparison(input: {
    tenantId: string;
    matches: readonly TraceAttributeMatch[];
    actorKey: string;
    previousStartMs: number;
    currentStartMs: number;
    endMs: number;
  }): Promise<TraceAttributedSpendComparison>;
  abstract findAttributedSpendByValue(input: {
    tenantId: string;
    matches: readonly TraceAttributeMatch[];
    valueKey: string;
    window: TraceModelSpendWindow;
    sortBy: TraceAttributedSpendSort;
    sortDirection: "asc" | "desc";
    limit: number;
    offset: number;
  }): Promise<TraceAttributedValueSpend[]>;
  abstract findAttributedSpendComparisonByValue(input: {
    tenantId: string;
    matches: readonly TraceAttributeMatch[];
    valueKey: string;
    previousStartMs: number;
    currentStartMs: number;
    endMs: number;
  }): Promise<TraceAttributedValueComparison[]>;
  abstract findSpendByProjectAndValue(input: {
    tenantIds: readonly string[];
    valueKey: string;
    window: TraceModelSpendWindow;
  }): Promise<TraceProjectValueSpend[]>;
  abstract findDailyAttributedSpend(input: {
    tenantId: string;
    matches: readonly TraceAttributeMatch[];
    groupBy: TraceDailySpendGroup;
    window: TraceModelSpendWindow;
  }): Promise<TraceDailyGroupSpend[]>;
  abstract countAttributedTracesByValue(input: {
    tenantId: string;
    matches: readonly TraceAttributeMatch[];
    valueKey: string;
    values: readonly string[];
    sinceMs: number;
  }): Promise<{ value: string; count: number }[]>;
  abstract findAttributedTracesBefore(input: {
    tenantId: string;
    matches: readonly TraceAttributeMatch[];
    attributeKeys: readonly string[];
    beforeMs: number;
    limit: number;
  }): Promise<TraceAttributedTraceDetail[]>;
  abstract getAttributedTraceRecency(input: {
    tenantId: string;
    matches: readonly TraceAttributeMatch[];
    countSinceMs: readonly number[];
  }): Promise<TraceAttributedRecency>;
}
