import {
  EvaluationNotFoundError,
  evaluationRunDataSchema,
  evaluationRunLookupSchema,
  upsertEvaluationRunCommandSchema,
  type EvaluationRunData,
  type EvaluationRunLookup,
  type UpsertEvaluationRunCommand,
} from "@langwatch/evaluation-contract";

import type { EvaluationRetentionFloor } from "../app/evaluation.members.ts";
import { EvaluationRunProjectionRepository } from "../repositories/evaluation-run-projection.repository.ts";
import type { EvaluationRunRepository } from "../repositories/evaluation.repository.ts";

/**
 * Run store without execution capability; mirrors {@link EvaluationService}
 * for ClickHouse consistency.
 */
export class EvaluationRunProjectionService extends EvaluationRunProjectionRepository {
  static create(options: {
    repository: EvaluationRunRepository;
    retentionFloor: EvaluationRetentionFloor;
  }): EvaluationRunProjectionService {
    return new EvaluationRunProjectionService(options.repository, options.retentionFloor);
  }

  private constructor(
    private readonly repository: EvaluationRunRepository,
    private readonly retentionFloor: EvaluationRetentionFloor,
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
        retentionFloor: this.retentionFloor,
      });
    } catch (error) {
      if (error instanceof EvaluationNotFoundError) return null;
      throw error;
    }
  }
}
