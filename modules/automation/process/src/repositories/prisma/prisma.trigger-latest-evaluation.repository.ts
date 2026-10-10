import type { TriggerLatestEvaluation } from "@langwatch/automation-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { TriggerLatestEvaluationRepository } from "../trigger-latest-evaluation.repository.ts";

/** Only what this repository touches. */
type TriggerLatestEvaluationDatabase = Pick<
  PrismaClient,
  "triggerLatestEvaluation" | "$executeRaw"
>;

export class PrismaTriggerLatestEvaluationRepository extends TriggerLatestEvaluationRepository {
  private constructor(private readonly database: TriggerLatestEvaluationDatabase) {
    super();
  }

  static create(
    database: TriggerLatestEvaluationDatabase,
  ): PrismaTriggerLatestEvaluationRepository {
    return new PrismaTriggerLatestEvaluationRepository(database);
  }

  /**
   * One `INSERT ... ON CONFLICT` rather than `upsert`: the key is the bare
   * trigger id, so only SQL can carry the `projectId` guard, and the sweep and
   * the live evaluator can race an alert's first check. Answers rows written.
   */
  upsert(input: TriggerLatestEvaluation): Promise<number> {
    return this.database.$executeRaw`
      INSERT INTO "TriggerLatestEvaluation" (
        "triggerId", "projectId", "evaluatedAt", "verdict", "observedValue",
        "threshold", "operator", "timePeriodMinutes", "skipCode", "updatedAt"
      ) VALUES (
        ${input.triggerId}, ${input.projectId}, ${input.evaluatedAt},
        ${input.verdict}, ${input.observedValue}, ${input.threshold},
        ${input.operator}, ${input.timePeriodMinutes}, ${input.skipCode}, NOW()
      )
      ON CONFLICT ("triggerId") DO UPDATE SET
        "evaluatedAt" = EXCLUDED."evaluatedAt",
        "verdict" = EXCLUDED."verdict",
        "observedValue" = EXCLUDED."observedValue",
        "threshold" = EXCLUDED."threshold",
        "operator" = EXCLUDED."operator",
        "timePeriodMinutes" = EXCLUDED."timePeriodMinutes",
        "skipCode" = EXCLUDED."skipCode",
        "updatedAt" = NOW()
      WHERE "TriggerLatestEvaluation"."projectId" = ${input.projectId}
    `;
  }

  async findByTriggerId(input: {
    projectId: string;
    triggerId: string;
  }): Promise<TriggerLatestEvaluation[]> {
    const rows = await this.database.triggerLatestEvaluation.findMany({
      where: { projectId: input.projectId, triggerId: input.triggerId },
    });
    return rows.map((row) => ({
      triggerId: row.triggerId,
      projectId: row.projectId,
      evaluatedAt: row.evaluatedAt,
      verdict: row.verdict,
      observedValue: row.observedValue,
      threshold: row.threshold,
      operator: row.operator,
      timePeriodMinutes: row.timePeriodMinutes,
      skipCode: row.skipCode,
    }));
  }
}
