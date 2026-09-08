/**
 * The change history one evaluator's detail panel renders. All three argument
 * names are load bearing: an evaluator's id appears under `id` on a rename,
 * `evaluatorId` on a run and `newEvaluatorId` on a copy.
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { EvaluatorAuditLogPort } from "../ports/evaluator.port.ts";

/** The one table this adapter reads for itself; the history comes from the audit log. */
export type EvaluatorAuditLogDatabase = {
  user: {
    findMany(input: {
      where: { id: { in: string[] } };
      select: { id: true; name: true; email: true };
    }): Promise<Array<{ id: string; name: string | null; email: string | null }>>;
  };
};

export class PrismaEvaluatorAuditLogAdapter extends EvaluatorAuditLogPort {
  static create(options: {
    database: EvaluatorAuditLogDatabase;
    auditLog: AuditLogApi;
  }): PrismaEvaluatorAuditLogAdapter {
    return new PrismaEvaluatorAuditLogAdapter(options.database, options.auditLog);
  }

  private constructor(
    private readonly database: EvaluatorAuditLogDatabase,
    private readonly auditLog: AuditLogApi,
  ) {
    super();
  }

  history(input: { evaluatorId: string; projectId: string; limit: number }) {
    return this.auditLog.listEntityHistory({
      projectId: input.projectId,
      actionPrefix: "evaluators.",
      entityId: input.evaluatorId,
      argumentNames: ["id", "evaluatorId", "newEvaluatorId"],
      limit: input.limit,
    });
  }

  users(input: { userIds: string[] }) {
    return this.database.user.findMany({
      where: { id: { in: input.userIds } },
      select: { id: true, name: true, email: true },
    });
  }
}
