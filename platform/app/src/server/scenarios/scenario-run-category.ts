import { ScenarioRunStatus } from "./scenario-event.enums";

/**
 * The outcome bucket a run falls into, independent of which specific status
 * produced it. ERROR and FAILED both mean "this run did not pass", but the
 * distinction between them still matters when reading a single run, so the
 * category is derived rather than replacing the status.
 */
export type RunStatusCategory =
  | "success"
  | "failure"
  | "stalled"
  | "cancelled"
  | "in_progress"
  | "queued";

/**
 * Buckets a run status for counting and filtering.
 *
 * Single source of truth for run-history summaries, the sidebar, and CSV
 * export. Anything that needs to answer "did this pass?" calls this rather
 * than switching on the status itself — otherwise the number on screen and
 * the number in an exported file can drift apart.
 *
 * The switch is exhaustive over ScenarioRunStatus with no default, so adding a
 * status to the enum is a compile error here until it is categorised.
 */
export function categorizeRunStatus(
  status: ScenarioRunStatus,
): RunStatusCategory {
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
      return "in_progress";
    case ScenarioRunStatus.QUEUED:
      return "queued";
  }
}
