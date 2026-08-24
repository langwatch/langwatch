import type { EvaluatorCopy, EvaluatorField, EvaluatorHistoryEntry } from "@langwatch/evaluator-contract";

export interface EvaluatorAuditLogPort {
  history(input: { evaluatorId: string; projectId: string; limit: number }): Promise<Array<{
    id: string; action: string; createdAt: Date; args: unknown; userId: string | null;
  }>>;
  users(input: { userIds: string[] }): Promise<Array<{ id: string; name: string | null; email: string | null }>>;
}

export type EvaluatorCopies = EvaluatorCopy[];
export type { EvaluatorField, EvaluatorHistoryEntry };
