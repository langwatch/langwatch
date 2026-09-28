import type { PrismaClient } from "~/generated/prisma/client";
import {
  findEvaluationFilterReferences,
  findUnkeyedFilterFields,
} from "~/server/filters/trigger-filter-shape";
import {
  TriggerFilterKeyRequiredError,
  TriggerFilterMonitorRequiredError,
} from "./errors";
import { PrismaEvaluatorReferenceRepository } from "./repositories/evaluator-reference.prisma.repository";
import type { EvaluatorReferenceRepository } from "./repositories/evaluator-reference.repository";

/**
 * The write-time check on an automation's structured conditions: refuse the
 * shapes that save fine and then match nothing. Stored rows are never
 * re-checked; only a save that states conditions is held to this.
 */
export class TriggerFilterValidationService {
  constructor(private readonly evaluators: EvaluatorReferenceRepository) {}

  static create(prisma: PrismaClient): TriggerFilterValidationService {
    return new TriggerFilterValidationService(
      new PrismaEvaluatorReferenceRepository(prisma),
    );
  }

  /**
   * Ids no Evaluator carries are let through: an SDK-reported evaluation keys
   * its results by its own `evaluator_id` or name slug, which no table here
   * knows, and refusing those would refuse working conditions.
   */
  async assertWritable({
    projectId,
    filters,
  }: {
    projectId: string;
    filters: Record<string, unknown>;
  }): Promise<void> {
    const [unkeyed] = findUnkeyedFilterFields(filters);
    if (unkeyed) throw new TriggerFilterKeyRequiredError(unkeyed);

    const references = findEvaluationFilterReferences(filters);
    if (references.length === 0) return;
    const evaluators = await this.evaluators.findAllByIds({
      projectId,
      ids: [...new Set(references.map((reference) => reference.id))],
    });
    const [evaluator] = evaluators;
    if (!evaluator) return;
    const reference = references.find(({ id }) => id === evaluator.evaluatorId);
    throw new TriggerFilterMonitorRequiredError({
      field: reference?.field ?? "evaluations",
      evaluatorId: evaluator.evaluatorId,
      monitorIds: evaluator.monitorIds,
    });
  }
}
