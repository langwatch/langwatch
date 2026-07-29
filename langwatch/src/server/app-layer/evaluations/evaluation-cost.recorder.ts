import { generate } from "@langwatch/ksuid";
import {
  CostReferenceType,
  CostType,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { KSUID_RESOURCES } from "../../../utils/constants";

/**
 * Interface for recording evaluation costs.
 * Consumers (command handlers) depend on this interface; the Prisma
 * implementation lives alongside it in the app-layer.
 */
export interface EvaluationCostRecorder {
  recordCost(params: {
    projectId: string;
    /**
     * Identity of the evaluation this cost belongs to. Used as the natural key
     * that makes the write idempotent, so a redelivered command bills once.
     */
    evaluationId: string;
    isGuardrail: boolean;
    evaluatorName: string;
    evaluatorId: string;
    traceId: string;
    amount: number;
    currency: string;
  }): Promise<string>;
}

/** Postgres unique-violation, as surfaced by Prisma. */
const PRISMA_UNIQUE_VIOLATION = "P2002";

/**
 * Namespaces the evaluation writer's claim on `Cost.idempotencyKey`, so a
 * future writer adopting the column cannot collide with an evaluation id.
 */
function evaluationCostIdempotencyKey(evaluationId: string): string {
  return `evaluation:${evaluationId}`;
}

/**
 * Records evaluation costs in the database via Prisma.
 *
 * The write is idempotent on `(projectId, idempotencyKey)`. It has to be:
 * the only caller is `ExecuteEvaluationCommand`, which records the cost
 * part-way through a handler running under the GroupQueue's at-least-once
 * delivery. A failure after this write but before the handler completes
 * re-runs the handler, and an unguarded `create` then wrote a second row for
 * the same evaluation — inflating both the license-enforcement aggregate and
 * the costs report. See the 20260729090000_cost_idempotency_key migration for
 * why the key is a dedicated column rather than a unique over the business
 * columns.
 */
export class PrismaEvaluationCostRecorder implements EvaluationCostRecorder {
  constructor(private readonly prisma: PrismaClient) {}

  async recordCost(params: {
    projectId: string;
    evaluationId: string;
    isGuardrail: boolean;
    evaluatorName: string;
    evaluatorId: string;
    traceId: string;
    amount: number;
    currency: string;
  }): Promise<string> {
    const idempotencyKey = evaluationCostIdempotencyKey(params.evaluationId);
    const costId = generate(KSUID_RESOURCES.COST).toString();

    try {
      // `update: {}` on purpose: a redelivery must NOT restate the amount.
      // The first attempt's row is the billed one, and rewriting it with a
      // second attempt's figure would silently change history for a row the
      // costs report has already shown.
      const cost = await this.prisma.cost.upsert({
        where: {
          projectId_idempotencyKey: {
            projectId: params.projectId,
            idempotencyKey,
          },
        },
        create: {
          id: costId,
          projectId: params.projectId,
          idempotencyKey,
          costType: params.isGuardrail
            ? CostType.GUARDRAIL
            : CostType.TRACE_CHECK,
          costName: params.evaluatorName,
          referenceType: CostReferenceType.CHECK,
          referenceId: params.evaluatorId,
          amount: params.amount,
          currency: params.currency,
          extraInfo: { trace_id: params.traceId },
        },
        update: {},
        select: { id: true },
      });
      return cost.id;
    } catch (error) {
      // Prisma's upsert is a read-then-write unless it can compile down to a
      // native ON CONFLICT, so two attempts overlapping in time (a visibility
      // -timeout redelivery while the first is still running) can both miss
      // the row and race to insert. The database constraint catches that; this
      // resolves it to the row that won rather than surfacing a 500 on a path
      // whose whole point is tolerating retries.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_VIOLATION
      ) {
        const existing = await this.prisma.cost.findUnique({
          where: {
            projectId_idempotencyKey: {
              projectId: params.projectId,
              idempotencyKey,
            },
          },
          select: { id: true },
        });
        if (existing) return existing.id;
      }
      throw error;
    }
  }
}
