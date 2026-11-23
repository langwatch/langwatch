import type { TraceTokenCounter } from "./token-counter.channel.ts";
import type { TraceEvaluationRuns } from "./trace-evaluation-runs.channel.ts";
import type { TraceInstantEvalResults } from "./trace-instant-eval-results.channel.ts";
import type { TraceLegacySpool } from "./trace-legacy-spool.channel.ts";

/** Every channel trace holds, as the container hands them to the module class. */
export interface TraceChannels {
  readonly tokenizer: TraceTokenCounter;
  readonly legacySpool: TraceLegacySpool;
  /** Evaluation's runs, for the outcomes trace records on its traces (trace ADR-003). */
  readonly evaluations: TraceEvaluationRuns;
  /** Instant-eval's kept results, for the drawer's Instant Evals section (ADR-189 section 3). */
  readonly instantEvalResults: TraceInstantEvalResults;
}
