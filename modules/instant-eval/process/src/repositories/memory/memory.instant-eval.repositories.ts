import type { InstantEvalCancellationRepository } from "../instant-eval-cancellation.repository.ts";
import type { InstantEvalRepositories } from "../instant-eval.repositories.ts";
import { MemoryInstantEvalBudgetReservationsRepository } from "./memory.instant-eval-budget-reservations.repository.ts";
import { MemoryInstantEvalJudgmentsRepository } from "./memory.instant-eval-judgments.repository.ts";
import { MemoryInstantEvalRateLimitRepository } from "./memory.instant-eval-rate-limit.repository.ts";
/**
 * The cancellation hint held in this process alone: what a deployment with no
 * Redis gets, where a run stops one page later off its recorded cancellation,
 * and what a suite drives the executor's stop path with.
 */
import { MemoryInstantEvalRunRepository } from "./memory.instant-eval-run.repository.ts";

export class MemoryInstantEvalCancellationRepository implements InstantEvalCancellationRepository {
  #requested = new Set<string>();

  private constructor() {}

  static create(): MemoryInstantEvalCancellationRepository {
    return new MemoryInstantEvalCancellationRepository();
  }

  async request({ runId }: { runId: string }): Promise<void> {
    this.#requested.add(runId);
  }

  async isRequested({ runId }: { runId: string }): Promise<boolean> {
    return this.#requested.has(runId);
  }
}

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
