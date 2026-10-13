import { InstantEvalApi } from "@langwatch/instant-eval-contract";
import type { BoundApis } from "@langwatch/process";

/** Every channel analytics holds, as the container hands them to the module class. */
export interface AnalyticsChannels {
  /** Judges a synchronous query's eval columns, publishes its limits and records the spend. */
  readonly judge: Pick<InstantEvalApi, "judgeQuery" | "getJudgeLimits">;
}

/**
 * Both tiers bind the judge: the binding is to a module, not a store, and is no peer
 * (Alex, 2026-10-08, round 34; record §5), so instant-eval may depend back on analytics.
 */
export class BoundAnalyticsChannels {
  static readonly requires = [] as const;
  static readonly binds = { judge: InstantEvalApi } as const;

  static create({
    bound,
  }: {
    bound: BoundApis<typeof BoundAnalyticsChannels.binds>;
  }): AnalyticsChannels {
    return { judge: bound.judge };
  }
}
