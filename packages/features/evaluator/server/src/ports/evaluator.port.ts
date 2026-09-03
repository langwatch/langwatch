import type { EvaluatorHistoryEntry } from "@langwatch/evaluator-contract";
import type { StudioClientEvent } from "@langwatch/workflow-contract";

export abstract class EvaluatorCodeExecutionPort {
  abstract execute(input: {
    projectId: string;
    event: StudioClientEvent;
    causalityDepth: number;
    parentTrace?: { traceId: string; parentSpanId: string };
  }): Promise<{
    ok: boolean;
    statusText: string;
    body: {
      result?: Record<string, unknown>;
      status: string;
      error?: { message?: string; traceback?: string };
    };
  }>;
}

export abstract class EvaluatorAuditLogPort {
  abstract history(input: { evaluatorId: string; projectId: string; limit: number }): Promise<
    Array<{
      id: string;
      action: string;
      createdAt: Date;
      args: unknown;
      userId: string | null;
    }>
  >;

  abstract users(input: { userIds: string[] }): Promise<
    Array<{
      id: string;
      name: string | null;
      email: string | null;
    }>
  >;
}

export type { EvaluatorHistoryEntry };
