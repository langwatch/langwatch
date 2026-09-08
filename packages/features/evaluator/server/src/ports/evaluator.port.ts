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
      createdAt: EvaluatorHistoryEntry["createdAt"];
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

/**
 * The workflow and monitor rows an evaluator is entangled with. Both belong to
 * other features, so the process reads and writes them; the evaluator feature
 * only says what it needs of them.
 */
export abstract class EvaluatorGraphPort {
  /** The evaluator's linked workflow, scoped to the project and not archived. */
  abstract findLinkedWorkflow(
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<{ id: string; name: string } | null>;
  /** The monitors in the project that run this evaluator. */
  abstract findMonitorsUsingEvaluator(
    input: Readonly<{ evaluatorId: string; projectId: string }>,
  ): Promise<{ id: string; name: string }[]>;
  /** Hard-deletes those monitors, and answers how many went. */
  abstract deleteMonitorsUsingEvaluator(
    input: Readonly<{ evaluatorId: string; projectId: string }>,
  ): Promise<{ count: number }>;
  /** Archives the evaluator's linked workflow. */
  abstract archiveLinkedWorkflow(
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<{ id: string }>;
  /** Clones a workflow evaluator's workflow into the target project. */
  abstract replicateEvaluatorWorkflow(
    input: Readonly<{
      workflowId: string;
      sourceProjectId: string;
      targetProjectId: string;
      actorId: string;
    }>,
  ): Promise<string>;
  /** Removes a workflow a replication created, when the evaluator insert fails. */
  abstract deleteReplicatedWorkflow(
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<void>;
}

export type { EvaluatorHistoryEntry };
