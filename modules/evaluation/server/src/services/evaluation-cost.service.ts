import { EvaluationCostRecorder } from "../app/evaluation.infrastructure.ts";
import {
  EvaluationCostAlreadyRecordedError,
  type EvaluationCostRepository,
} from "../repositories/evaluation-cost.repository.ts";

/** The row id one run's cost is written under, derived from its idempotency key. */
function costIdOf(idempotencyKey: string): string {
  return `evaluation-cost:${idempotencyKey}`;
}

/**
 * Writes what a completed evaluation run cost, once. A redelivery of the same
 * run reuses the row already there rather than billing the project twice.
 */
export class EvaluationCostService implements EvaluationCostRecorder {
  readonly #repository: EvaluationCostRepository;

  private constructor(repository: EvaluationCostRepository) {
    this.#repository = repository;
  }

  static create(input: Readonly<{ repository: EvaluationCostRepository }>): EvaluationCostService {
    return new EvaluationCostService(input.repository);
  }

  async recordCost(input: {
    projectId: string;
    isGuardrail: boolean;
    evaluatorName: string;
    evaluatorId: string;
    traceId: string;
    idempotencyKey: string;
    amount: number;
    currency: string;
  }): Promise<string> {
    const id = costIdOf(input.idempotencyKey);

    try {
      await this.#repository.create({
        id,
        projectId: input.projectId,
        isGuardrail: input.isGuardrail,
        evaluatorName: input.evaluatorName,
        evaluatorId: input.evaluatorId,
        traceId: input.traceId,
        amount: input.amount,
        currency: input.currency,
      });

      return id;
    } catch (error) {
      if (!(error instanceof EvaluationCostAlreadyRecordedError)) throw error;

      const recorded = await this.#repository.findById({ id, projectId: input.projectId });
      if (!recorded) throw error;

      return recorded.id;
    }
  }
}
