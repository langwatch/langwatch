/**
 * The run-state half of a streaming execution.
 *
 * A run started by an open tab used to exist only inside that tab, so
 * `GET /runs/:runId` answered 404 for it and `langwatch experiment status`
 * could not follow a run it had just started. The store is Redis, so a poll
 * served by a different process finds the run too.
 *
 * This lives beside the runner rather than in the route, so the route stays
 * request handling and stream output and the run's lifecycle stays with the
 * execution layer that owns it.
 */
import type { SerializedHandledError } from "@langwatch/handled-error";
import { runStateManager } from "./runStateManager";
import type { EvaluationV3Event } from "./types";

/** What a caller feeds one run's stream into. */
export interface RunStateMirror {
  /** Record one frame. The first `execution_started` frame opens the run. */
  record(event: EvaluationV3Event): Promise<void>;
  /**
   * Record that the run died before it reported how it ended.
   *
   * Not written once the run has reported that, since a write after the last
   * frame would rewrite a finished run as a failed one.
   */
  fail(failure: {
    code: string;
    domainError?: SerializedHandledError;
    traceId?: string;
  }): Promise<void>;
}

/** Open a mirror for one run of one experiment. */
export const createRunStateMirror = ({
  projectId,
  experimentId,
  experimentSlug,
}: {
  projectId: string;
  experimentId?: string;
  experimentSlug: string;
}): RunStateMirror => {
  let runId: string | undefined;
  let ended = false;

  const recordEnd = async (event: EvaluationV3Event): Promise<void> => {
    if (!runId) return;
    if (event.type === "done") {
      ended = true;
      await runStateManager.completeRun(runId, event.summary);
      return;
    }
    if (event.type === "stopped") {
      ended = true;
      await runStateManager.stopRun(runId);
    }
  };

  return {
    async record(event: EvaluationV3Event): Promise<void> {
      if (event.type === "execution_started") {
        runId = event.runId;
        await runStateManager.createRun({
          runId: event.runId,
          projectId,
          experimentId,
          experimentSlug,
          total: event.total,
        });
        return;
      }
      if (!runId) return;
      await runStateManager.addEvent(runId, event);
      await recordEnd(event);
    },
    async fail(failure: {
      code: string;
      domainError?: SerializedHandledError;
      traceId?: string;
    }): Promise<void> {
      if (!runId || ended) return;
      await runStateManager.failRun(runId, failure);
    },
  };
};
