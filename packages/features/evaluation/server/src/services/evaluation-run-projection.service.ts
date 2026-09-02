import {
  evaluationRunDataSchema,
  evaluationRunLookupSchema,
  upsertEvaluationRunCommandSchema,
  type EvaluationRunData,
  type EvaluationRunLookup,
  type UpsertEvaluationRunCommand,
} from "@langwatch/evaluation-contract";
import { EvaluationRunProjectionPort } from "../ports/evaluation-run-projection.port";
import type { EvaluationRunRepository } from "../repositories/evaluation.repository";

/**
 * Evaluation's run store, without the execution capability around it.
 *
 * The three methods are byte-for-byte the ones {@link EvaluationService}
 * implements — the same two schema parses before the same two repository
 * calls — because both write the SAME ClickHouse rows. A process that skipped
 * a parse here would store a run the other process could not read back, and a
 * process that chose a different retention default would expire it early.
 *
 * It exists because composing the full service to reach these three would
 * mean handing it an evaluator executor and a Workflow service this path
 * provably never calls, and a graph that names a collaborator it cannot use
 * is how a boot refusal turns into a runtime one.
 */
export class EvaluationRunProjectionService extends EvaluationRunProjectionPort {
  static create(options: { repository: EvaluationRunRepository }): EvaluationRunProjectionService {
    return new EvaluationRunProjectionService(options.repository);
  }

  private constructor(private readonly repository: EvaluationRunRepository) {
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

  tryGetRunByEvaluationId(input: EvaluationRunLookup): Promise<EvaluationRunData | null> {
    return this.repository.tryFindByEvaluationId(evaluationRunLookupSchema.parse(input));
  }
}
