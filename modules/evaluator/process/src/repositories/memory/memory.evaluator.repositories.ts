import type { EvaluatorRepositories } from "../evaluator.repositories.ts";
import { MemoryEvaluatorRepository } from "./memory.evaluator.repository.ts";

export class MemoryEvaluatorRepositories {
  static readonly requires = [] as const;

  static create(): EvaluatorRepositories {
    return { evaluators: MemoryEvaluatorRepository.create() };
  }
}
