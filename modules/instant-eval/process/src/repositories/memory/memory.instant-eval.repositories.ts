import type { InstantEvalRepositories } from "../instant-eval.repositories.ts";
import { MemoryInstantEvalJudgmentsRepository } from "./memory.instant-eval-judgments.repository.ts";
import { MemoryInstantEvalRunRepository } from "./memory.instant-eval-run.repository.ts";

/** The "memory" tier: both stores in process, for installation and service tests. */
export class MemoryInstantEvalRepositories {
  static readonly requires = [] as const;

  static create(): InstantEvalRepositories {
    return {
      runs: MemoryInstantEvalRunRepository.create(),
      judgments: MemoryInstantEvalJudgmentsRepository.create(),
    };
  }
}
