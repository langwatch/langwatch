import type { InstantEvalJudgmentsRepository } from "./instant-eval-judgments.repository.ts";
import type { InstantEvalRunRepository } from "./instant-eval-run.repository.ts";

/** Every store this module owns: the run's own row, and its judgements. */
export interface InstantEvalRepositories {
  readonly runs: InstantEvalRunRepository;
  readonly judgments: InstantEvalJudgmentsRepository;
}
