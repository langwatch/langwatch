import {
  EvaluationNotFoundError,
  evaluationRunDataSchema,
  evaluationRunLookupSchema,
  upsertEvaluationRunCommandSchema,
  type EvaluationRunData,
  type EvaluationRunLookup,
  type UpsertEvaluationRunCommand,
} from "@langwatch/evaluation-contract";

import type { EvaluationRetentionLookup } from "../app/evaluation.members.ts";
import { EvaluationRunProjectionRepository } from "../repositories/evaluation-run-projection.repository.ts";
import type { EvaluationRunRepository } from "../repositories/evaluation.repository.ts";

/**
 * Run store without execution capability; mirrors {@link EvaluationService}
 * for ClickHouse consistency.
 */
export class EvaluationRunProjectionService extends EvaluationRunProjectionRepository {
  static create(options: {
    repository: EvaluationRunRepository;
    retention: EvaluationRetentionLookup;
  }): EvaluationRunProjectionService {
    return new EvaluationRunProjectionService(options.repository, options.retention);
  }

  private constructor(
    private readonly repository: EvaluationRunRepository,
    private readonly retention: EvaluationRetentionLookup,
  ) {
    super();
  }

  async upsertRun(input: UpsertEvaluationRunCommand): Promise<void> {
    const command = upsertEvaluationRunCommandSchema.parse(input);
    await this.repository.upsert({
      data: evaluationRunDataSchema.parse(command.data),
      tenantId: command.tenantId,
      retentionDays: command.retentionDays,
    });
  }

  async upsertRuns(input: UpsertEvaluationRunCommand[]): Promise<void> {
    const commands = input.map((entry) => upsertEvaluationRunCommandSchema.parse(entry));
    await this.repository.upsertBatch(
      commands.map((command) => ({
        data: evaluationRunDataSchema.parse(command.data),
        tenantId: command.tenantId,
        retentionDays: command.retentionDays,
      })),
    );
  }

  async findRunByEvaluationId(input: EvaluationRunLookup): Promise<EvaluationRunData | null> {
    try {
      return await this.repository.getByEvaluationId({
        ...evaluationRunLookupSchema.parse(input),
        retention: this.retention,
      });
    } catch (error) {
      if (error instanceof EvaluationNotFoundError) return null;
      throw error;
    }
  }
}
