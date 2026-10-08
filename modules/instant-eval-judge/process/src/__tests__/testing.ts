/**
 * Test-only: the Instant Evals judge over memory tables, for a peer's suite that drives the facts
 * the judge folds. Application code reaches the judge only through `InstantEvalJudgeApi`.
 */
export { instantEvalJudgeOverMemory } from "./support/instant-eval-judge-over-memory.test-fakes.ts";
export type { InstantEvalJudgeOverMemory } from "./support/instant-eval-judge-over-memory.test-fakes.ts";
