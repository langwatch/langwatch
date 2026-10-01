import type { EvaluatorRepository } from "./evaluator.repository.ts";

/** The rows this feature owns: one table, one repository. */
export interface EvaluatorRepositories {
  readonly evaluators: EvaluatorRepository;
}
