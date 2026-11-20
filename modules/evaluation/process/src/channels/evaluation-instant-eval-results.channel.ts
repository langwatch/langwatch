import type { InstantEvalApi } from "@langwatch/instant-eval-contract";

/**
 * What evaluation asks instant-eval for a monitor's judge on Instant Evals: its kept verdict, and
 * keeping a new one (ADR-189 section 5). Bound to instant-eval's API, not a peer, since
 * instant-eval reaches evaluation through gateway (§5).
 */
export type EvaluationInstantEvalResults = Pick<
  InstantEvalApi,
  "findMonitorJudgments" | "keepMonitorJudgment"
>;
