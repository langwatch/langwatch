import type { EvaluatorHistoryEntry } from "@langwatch/evaluator-contract";

export abstract class EvaluatorAuditLogPort {
  abstract history(input: {
    evaluatorId: string;
    projectId: string;
    limit: number;
  }): Promise<Array<{
    id: string;
    action: string;
    createdAt: Date;
    args: unknown;
    userId: string | null;
  }>>;

  abstract users(input: { userIds: string[] }): Promise<Array<{
    id: string;
    name: string | null;
    email: string | null;
  }>>;
}

export type { EvaluatorHistoryEntry };
