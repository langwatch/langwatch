/**
 * The change history one evaluator's detail panel renders, read off the
 * deployment's audit trail and named against the user directory.
 *
 * All three argument names are load bearing: an evaluator's id appears under
 * `id` on a rename, `evaluatorId` on a run and `newEvaluatorId` on a copy.
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { EvaluatorHistoryEntry } from "@langwatch/evaluator-contract";

/** How far back one evaluator's panel reads. */
const HISTORY_LIMIT = 100;

/** One person, as a history row names them. */
export type EvaluatorActor = Readonly<{
  id: string;
  name: string | null;
  email: string | null;
}>;

/**
 * Who made each change, answered by the process from its own user directory.
 * Three fields, because three fields are what a history row renders; the
 * module holds no user rows and asks for no more of them.
 */
export interface EvaluatorActorDirectory {
  findByIds(input: { userIds: string[] }): Promise<EvaluatorActor[]>;
}

export class EvaluatorHistoryService {
  static create(options: {
    auditLog: AuditLogApi;
    actors: EvaluatorActorDirectory;
  }): EvaluatorHistoryService {
    return new EvaluatorHistoryService(options.auditLog, options.actors);
  }

  private constructor(
    private readonly auditLog: AuditLogApi,
    private readonly actors: EvaluatorActorDirectory,
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
    const actors = await this.actors.findByIds({ userIds });
    const byId = new Map(actors.map((actor) => [actor.id, actor]));

    return entries.map((entry) => ({
      id: entry.id,
      action: entry.action,
      createdAt: entry.createdAt,
      args: entry.args,
      user: entry.userId ? (byId.get(entry.userId) ?? null) : null,
    }));
  }
}
