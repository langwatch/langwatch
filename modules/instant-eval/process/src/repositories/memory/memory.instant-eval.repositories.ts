import type { InstantEvalRepositories } from "../instant-eval.repositories.ts";
import { MemoryInstantEvalJudgmentsRepository } from "./memory.instant-eval-judgments.repository.ts";
import { MemoryInstantEvalRunRepository } from "./memory.instant-eval-run.repository.ts";

/** Both stores in process, for installation and service tests. */
export class MemoryInstantEvalRepositories implements InstantEvalRepositories {
  readonly runs: MemoryInstantEvalRunRepository;
  readonly judgments: MemoryInstantEvalJudgmentsRepository;

  private constructor() {
    this.runs = MemoryInstantEvalRunRepository.create();
    this.judgments = MemoryInstantEvalJudgmentsRepository.create();
  }

  static create(): MemoryInstantEvalRepositories {
    return new MemoryInstantEvalRepositories();
  }
}
