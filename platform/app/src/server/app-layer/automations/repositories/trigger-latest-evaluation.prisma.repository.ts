import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import type {
  EvaluationSkipCode,
  EvaluationVerdict,
  RecordEvaluationInput,
  TriggerLatestEvaluation,
  TriggerLatestEvaluationRepository,
} from "./trigger-latest-evaluation.repository";

const logger = createLogger("langwatch:automations:latest-evaluation");

export class PrismaTriggerLatestEvaluationRepository
  implements TriggerLatestEvaluationRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Written as a single `INSERT … ON CONFLICT DO UPDATE` rather than
   * `prisma.upsert` for two reasons, both structural:
   *
   *   - `upsert` keys on the model's unique input, which here is the bare
   *     `triggerId` primary key. The multitenancy middleware requires a
   *     `projectId` in the where clause of every non-create action, so the
   *     Prisma form cannot be scoped and is rejected outright. The statement
   *     below carries `projectId` in both the inserted row and the conflict
   *     update's guard, which is the same constraint expressed in SQL.
   *   - The real-time subscriber and the heartbeat sweep can evaluate the
   *     same alert concurrently. A read-then-write pair races on the alert's
   *     very first evaluation; this is one atomic statement, so the later
   *     write simply wins.
   */
  async upsert(input: RecordEvaluationInput): Promise<void> {
    const affectedRows = await this.prisma.$executeRaw`
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
    // The conflict guard can block the update — it only fires when the stored
    // row belongs to the same project, which is the tenancy check. Zero rows
    // means the write was silently dropped, and a drawer stuck on a stale
    // observation is exactly the confusion this feature exists to remove, so
    // it is said out loud rather than left to be inferred from a frozen
    // timestamp.
    if (affectedRows === 0) {
      logger.warn(
        {
          projectId: input.projectId,
          triggerId: input.triggerId,
          verdict: input.verdict,
        },
        "the latest-evaluation write affected no rows — an existing row for this trigger belongs to another project",
      );
    }
  }

  async findByTriggerId({
    projectId,
    triggerId,
  }: {
    projectId: string;
    triggerId: string;
  }): Promise<TriggerLatestEvaluation | null> {
    const row = await this.prisma.triggerLatestEvaluation.findFirst({
      where: { projectId, triggerId },
    });
    if (!row) return null;
    return {
      triggerId: row.triggerId,
      projectId: row.projectId,
      evaluatedAt: row.evaluatedAt,
      verdict: row.verdict as EvaluationVerdict,
      observedValue: row.observedValue,
      threshold: row.threshold,
      operator: row.operator,
      timePeriodMinutes: row.timePeriodMinutes,
      skipCode: row.skipCode as EvaluationSkipCode | null,
    };
  }
}
