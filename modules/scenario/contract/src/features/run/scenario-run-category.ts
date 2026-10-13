import { ScenarioRunStatus } from "./scenario-run.ts";

/**
 * The outcome bucket a run falls into, independent of which status produced
 * it. ERROR and FAILED both mean "did not pass", but the distinction still
 * matters reading a single run, so the category is derived, not a replacement.
 */
export type RunStatusCategory =
  | "success"
  | "failure"
  | "stalled"
  | "cancelled"
  | "in_progress"
  | "queued";

/**
 * Buckets run status for filtering. Single source of truth for export and display counts.
 */
export function categorizeRunStatus(status: ScenarioRunStatus): RunStatusCategory {
  switch (status) {
    case ScenarioRunStatus.SUCCESS:
      return "success";
    case ScenarioRunStatus.ERROR:
    case ScenarioRunStatus.FAILED:
      return "failure";
    case ScenarioRunStatus.STALLED:
      return "stalled";
    case ScenarioRunStatus.CANCELLED:
      return "cancelled";
    case ScenarioRunStatus.IN_PROGRESS:
    case ScenarioRunStatus.PENDING:
    case ScenarioRunStatus.RUNNING:
    // The conversation is over, but a required evaluator can still fail the
    // run, so it is not counted as a pass or a failure until they are in.
    case ScenarioRunStatus.PENDING_EVALUATION:
      return "in_progress";
    case ScenarioRunStatus.QUEUED:
      return "queued";
  }
}
