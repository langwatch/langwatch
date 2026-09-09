import type { SerializedHandledError } from "@langwatch/handled-error";
import type { EvaluationV3Event, ExecutionSummary } from "@langwatch/experiment-contract";

/**
 * One run's progress, where a poller can read it.
 *
 * `POST /run` answers with a run id and leaves the run streaming on one
 * process; `GET /runs/:runId` is served by whichever process took the poll. So
 * the progress cannot live in the run's own memory. The retired application
 * kept it in Redis under a 24-hour TTL and skipped every write when the process
 * had no connection; the skip is now a composition choice — a deployment that
 * composes no store cannot serve the polling API at all, which is the honest
 * version of the same fact.
 */
export type ExperimentRunProgressSummary = ExecutionSummary & {
  /** Extended summary for CI output */
  targets?: Array<{
    targetId: string;
    name: string;
    passed: number;
    failed: number;
    avgLatency: number;
    totalCost: number;
  }>;
  evaluators?: Array<{
    evaluatorId: string;
    name: string;
    passed: number;
    failed: number;
    passRate: number;
    avgScore?: number;
  }>;
  totalPassed?: number;
  totalFailed?: number;
  passRate?: number;
  totalCost?: number;
  runUrl?: string;
};

/** One run, as a poller reads it. */
export type ExperimentRunProgressState = {
  runId: string;
  projectId: string;
  experimentId?: string;
  experimentSlug: string;
  status: "pending" | "running" | "completed" | "failed" | "stopped";
  progress: number;
  total: number;
  startedAt: number;
  finishedAt?: number;
  summary?: ExperimentRunProgressSummary;
  /**
   * The failure's stable code — a handled error's own, or the unnamed-failure
   * marker. Never the thrown error's message: `GET /runs/:runId` hands this
   * straight to any API consumer, and a raw message there is the same leak the
   * live stream stopped shipping (ADR-045).
   */
  error?: string;
  /** The serialised handled error, when the failure had one. */
  domainError?: SerializedHandledError;
  /** The trace to hand support — all an unnamed failure gives a caller. */
  traceId?: string;
  /** Recent events for debugging (last 50) */
  recentEvents?: EvaluationV3Event[];
};

/** How a failure is recorded: the code the customer may read, never the message. */
export type ExperimentRunProgressFailure = {
  code: string;
  domainError?: SerializedHandledError;
  traceId?: string;
};

export abstract class ExperimentRunProgressPort {
  abstract createRun(input: {
    runId: string;
    projectId: string;
    experimentId?: string;
    experimentSlug: string;
    total: number;
  }): Promise<void>;
  abstract updateProgress(runId: string, progress: number): Promise<void>;
  abstract addEvent(runId: string, event: EvaluationV3Event): Promise<void>;
  abstract completeRun(
    runId: string,
    summary: ExperimentRunProgressSummary | undefined,
  ): Promise<void>;
  abstract failRun(runId: string, failure: ExperimentRunProgressFailure): Promise<void>;
  abstract stopRun(runId: string): Promise<void>;
  abstract tryGetRunState(runId: string): Promise<ExperimentRunProgressState | null>;
  abstract deleteRun(runId: string): Promise<void>;
}
