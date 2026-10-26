import { createLogger } from "@langwatch/observability";
import type { ExecuteSyncRelayAnswer, ExecuteSyncRelayEvent } from "@langwatch/workflow-contract";

import type { WorkflowNlpRuntime } from "../app/workflow.app.ts";
import {
  NlpInvokeAbortedError,
  NlpInvokeTimeoutError,
} from "../channels/workflow-nlp-lambda.channel.ts";

const logger = createLogger("langwatch:workflows:execute-sync-relay");

/**
 * Runs a scenario child's turn on its project's own engine and answers the engine's status and
 * body unchanged: the child's adapters classify every failure from exactly those two values.
 * No causality depth (it would stop ON_MESSAGE monitors) and no parent trace (`do_not_trace`).
 */
export class WorkflowExecuteSyncRelayService {
  static create(options: {
    runtime: WorkflowNlpRuntime;
    turnCeilingMs: number;
  }): WorkflowExecuteSyncRelayService {
    return new WorkflowExecuteSyncRelayService(options);
  }

  private constructor(
    private readonly options: { runtime: WorkflowNlpRuntime; turnCeilingMs: number },
  ) {}

  async relay({
    projectId,
    event,
    signal,
  }: {
    projectId: string;
    event: ExecuteSyncRelayEvent;
    signal: AbortSignal;
  }): Promise<ExecuteSyncRelayAnswer> {
    try {
      const answer = await this.options.runtime.dispatch({
        projectId,
        body: event,
        origin: "scenario",
        signal,
        timeoutMs: this.options.turnCeilingMs,
      });
      const body = await answer.text();
      return { kind: "engine", status: answer.status, body };
    } catch (error) {
      if (error instanceof NlpInvokeTimeoutError) {
        logger.warn({ projectId }, "scenario execute_sync exceeded the platform turn ceiling");
        return { kind: "refused", status: 504, error: "The engine did not answer in time" };
      }
      // The child is gone; answering keeps a stopped run out of the error log.
      if (error instanceof NlpInvokeAbortedError) {
        return { kind: "refused", status: 408, error: "The caller went away" };
      }
      throw error;
    }
  }
}
