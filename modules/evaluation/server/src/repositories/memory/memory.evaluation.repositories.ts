import type { EvaluationRepositories } from "../evaluation.repositories.ts";
import { MemoryEvaluationCostRepository } from "./memory.evaluation-cost.repository.ts";

export class MemoryEvaluationRepositories {
  static readonly requires = [] as const;

  static create(): EvaluationRepositories {
    return { costs: MemoryEvaluationCostRepository.create() };
  }
}
