import type {
  TraceAttributedRecency,
  TraceAttributedSpendComparison,
  TraceAttributedTraceDetail,
  TraceAttributedValueComparison,
  TraceAttributedValueSpend,
  TraceDailyGroupSpend,
  TraceProjectValueSpend,
} from "@langwatch/trace-contract";

import { TraceAttributedRollupRepository } from "../trace-attributed-rollup.repository.ts";

/** Memory stores hold no trace summaries, so every attributed rollup answers empty. */
export class MemoryNullTraceAttributedRollupRepository extends TraceAttributedRollupRepository {
  private constructor() {
    super();
  }

  static create(): MemoryNullTraceAttributedRollupRepository {
    return new MemoryNullTraceAttributedRollupRepository();
  }

  async getAttributedSpendComparison(): Promise<TraceAttributedSpendComparison> {
    return { currentSpendUsd: 0, previousSpendUsd: 0, currentActors: 0 };
  }

  async findAttributedSpendByValue(): Promise<TraceAttributedValueSpend[]> {
    return [];
  }

  async findAttributedSpendComparisonByValue(): Promise<TraceAttributedValueComparison[]> {
    return [];
  }

  async findSpendByProjectAndValue(): Promise<TraceProjectValueSpend[]> {
    return [];
  }

  async findDailyAttributedSpend(): Promise<TraceDailyGroupSpend[]> {
    return [];
  }

  async countAttributedTracesByValue(): Promise<{ value: string; count: number }[]> {
    return [];
  }

  async findAttributedTracesBefore(): Promise<TraceAttributedTraceDetail[]> {
    return [];
  }

  async getAttributedTraceRecency(input: {
    countSinceMs: readonly number[];
  }): Promise<TraceAttributedRecency> {
    return { counts: input.countSinceMs.map(() => 0), lastOccurredAtMs: 0 };
  }
}
