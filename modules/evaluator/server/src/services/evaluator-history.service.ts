/**
 * The change history one evaluator's detail panel renders, read off the
 * deployment's audit trail and named against the user directory.
 *
 * All three argument names are load bearing: an evaluator's id appears under
 * `id` on a rename, `evaluatorId` on a run and `newEvaluatorId` on a copy.
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { EvaluatorHistoryEntry } from "@langwatch/evaluator-contract";
import type { UserApi } from "@langwatch/user-contract";

/** How far back one evaluator's panel reads. */
const HISTORY_LIMIT = 100;

export class EvaluatorHistoryService {
  static create(options: { auditLog: AuditLogApi; users: UserApi }): EvaluatorHistoryService {
    return new EvaluatorHistoryService(options.auditLog, options.users);
  }

  private constructor(
    private readonly auditLog: AuditLogApi,
    private readonly users: UserApi,
  ) {}

  async listForEvaluator(input: {
    evaluatorId: string;
    projectId: string;
  }): Promise<EvaluatorHistoryEntry[]> {
    const entries = await this.auditLog.listEntityHistory({
      projectId: input.projectId,
      actionPrefix: "evaluators.",
      entityId: input.evaluatorId,
      argumentNames: ["id", "evaluatorId", "newEvaluatorId"],
      limit: HISTORY_LIMIT,
    });
    const userIds = [
      ...new Set(entries.map((entry) => entry.userId).filter((id): id is string => Boolean(id))),
    ];
    const profiles = await this.users.getProfiles({ userIds });
    const byId = new Map(
      profiles.map((profile) => [
        profile.id,
        { id: profile.id, name: profile.name, email: profile.email },
      ]),
    );

    return entries.map((entry) => ({
      id: entry.id,
      action: entry.action,
      createdAt: entry.createdAt,
      args: entry.args,
      user: entry.userId ? (byId.get(entry.userId) ?? null) : null,
    }));
  }
}
