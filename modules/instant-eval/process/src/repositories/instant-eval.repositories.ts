import type { InstantEvalBudgetReservationsRepository } from "./instant-eval-budget-reservations.repository.ts";
import type { InstantEvalCancellationRepository } from "./instant-eval-cancellation.repository.ts";
import type { InstantEvalJudgmentsRepository } from "./instant-eval-judgments.repository.ts";
import type { InstantEvalRateLimitRepository } from "./instant-eval-rate-limit.repository.ts";
import type { InstantEvalRunRepository } from "./instant-eval-run.repository.ts";

/**
 * Every store this module owns: the run's own row and its judgements, the
 * cancellation hints, the free-budget holds and the judge's token buckets.
 */
export interface InstantEvalRepositories {
  readonly runs: InstantEvalRunRepository;
  readonly judgments: InstantEvalJudgmentsRepository;
  readonly cancellations: InstantEvalCancellationRepository;
  readonly budgetReservations: InstantEvalBudgetReservationsRepository;
  readonly rateLimits: InstantEvalRateLimitRepository;
}
