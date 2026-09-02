/**
 * The change history one evaluator's detail panel renders.
 *
 * Moved from the platform app's `runtime/app/features/evaluator.ts`, including
 * the three JSON paths the audit rows are matched on. All three are load
 * bearing: an evaluator's id appears under `id` on a rename, `evaluatorId` on
 * a run, and `newEvaluatorId` on a copy, so dropping any of them silently
 * shortens a customer's history rather than failing.
 */
import { EvaluatorAuditLogPort } from "../ports/evaluator.port";

/** The two tables this adapter reads, named structurally. */
export type EvaluatorAuditLogDatabase = {
  auditLog: {
    findMany(input: {
      where: {
        projectId: string;
        action: { startsWith: string };
        OR: Array<{ args: { path: string[]; equals: string } }>;
      };
      orderBy: { createdAt: "desc" };
      take: number;
    }): Promise<
      Array<{
        id: string;
        action: string;
        createdAt: Date;
        args: unknown;
        userId: string | null;
      }>
    >;
  };
  user: {
    findMany(input: {
      where: { id: { in: string[] } };
      select: { id: true; name: true; email: true };
    }): Promise<Array<{ id: string; name: string | null; email: string | null }>>;
  };
};

export class PrismaEvaluatorAuditLogAdapter extends EvaluatorAuditLogPort {
  static create(database: EvaluatorAuditLogDatabase): PrismaEvaluatorAuditLogAdapter {
    return new PrismaEvaluatorAuditLogAdapter(database);
  }

  private constructor(private readonly database: EvaluatorAuditLogDatabase) {
    super();
  }

  history(input: { evaluatorId: string; projectId: string; limit: number }) {
    return this.database.auditLog.findMany({
      where: {
        projectId: input.projectId,
        action: { startsWith: "evaluators." },
        OR: [
          { args: { path: ["id"], equals: input.evaluatorId } },
          { args: { path: ["evaluatorId"], equals: input.evaluatorId } },
          { args: { path: ["newEvaluatorId"], equals: input.evaluatorId } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: input.limit,
    });
  }

  users(input: { userIds: string[] }) {
    return this.database.user.findMany({
      where: { id: { in: input.userIds } },
      select: { id: true, name: true, email: true },
    });
  }
}
