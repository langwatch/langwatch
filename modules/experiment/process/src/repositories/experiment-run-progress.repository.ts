import type { EvaluationV3Event, ExecutionSummary } from "@langwatch/experiment-contract";
import type { SerializedHandledError } from "@langwatch/handled-error";

/**
 * One run's progress that a poller can read. The run streams on one process but polls are
 * served by any process, so progress must live outside the run's memory.
 */
export type ExperimentRunProgressSummary = ExecutionSummary & {
  /** Extended summary for CI output */
  targets?: {
    targetId: string;
    name: string;
    passed: number;
    failed: number;
    avgLatency: number;
    totalCost: number;
  }[];
  evaluators?: {
    evaluatorId: string;
    name: string;
    passed: number;
    failed: number;
    passRate: number;
    avgScore?: number;
  }[];
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
   * straight to any consumer, the same leak the live stream stopped shipping.
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

export abstract class ExperimentRunProgressRepository {
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
  abstract findRunState(runId: string): Promise<ExperimentRunProgressState | null>;
  abstract deleteRun(runId: string): Promise<void>;
}
