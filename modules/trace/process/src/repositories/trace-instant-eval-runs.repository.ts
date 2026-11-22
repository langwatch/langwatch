import type { Instant } from "@langwatch/time";

/** One run instant-eval recorded, as far as dating its judgements needs it. */
export interface TraceInstantEvalRunRow {
  readonly runId: string;
  readonly createdAt: Instant;
  readonly finishedAt: Instant | null;
}

/**
 * Instant-eval's runs, read through the `instant_eval_runs` table it shares
 * with trace for reading (R40, round 47); trace writes none.
 * @see specs/traces-v2/instant-eval-search.feature
 */
export abstract class TraceInstantEvalRunsReadRepository {
  /** The latest version of each named run the project recorded; another project's are absent. */
  abstract findRunsByIds(input: {
    projectId: string;
    runIds: readonly string[];
  }): Promise<TraceInstantEvalRunRow[]>;
}
