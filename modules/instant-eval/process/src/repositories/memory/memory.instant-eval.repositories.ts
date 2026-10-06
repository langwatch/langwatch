import type { InstantEvalRepositories } from "../instant-eval.repositories.ts";
import { MemoryInstantEvalBudgetReservationsRepository } from "./memory.instant-eval-budget-reservations.repository.ts";
import { MemoryInstantEvalCancellationRepository } from "./memory.instant-eval-cancellation.repository.ts";
import { MemoryInstantEvalJudgmentsRepository } from "./memory.instant-eval-judgments.repository.ts";
import { MemoryInstantEvalRateLimitRepository } from "./memory.instant-eval-rate-limit.repository.ts";
import { MemoryInstantEvalRunRepository } from "./memory.instant-eval-run.repository.ts";

/** The "memory" tier: every store in process, for installation and service tests. */
export class MemoryInstantEvalRepositories {
  static readonly requires = [] as const;

  static create(): InstantEvalRepositories {
    return {
      runs: MemoryInstantEvalRunRepository.create(),
      judgments: MemoryInstantEvalJudgmentsRepository.create(),
      cancellations: MemoryInstantEvalCancellationRepository.create(),
      budgetReservations: MemoryInstantEvalBudgetReservationsRepository.create(),
      rateLimits: MemoryInstantEvalRateLimitRepository.create(),
    };
  }
}
