/**
 * Pure formatting for scenario run status labels: raw status + evaluation
 * results become human-readable labels, e.g. "passed (4/5)".
 * @see specs/features/suites/suite-list-view-status.feature
 */

import { SimulationRunStatus as ScenarioRunStatus } from "@langwatch/scenario-contract";

type CriteriaResults = {
  metCriteria: string[];
  unmetCriteria: string[];
};

type FormatRunStatusLabelInput = {
  status: ScenarioRunStatus;
  results?: CriteriaResults | null;
};

const STATUS_LABELS: Record<ScenarioRunStatus, string> = {
  [ScenarioRunStatus.SUCCESS]: "Passed",
  [ScenarioRunStatus.FAILED]: "Failed",
  [ScenarioRunStatus.ERROR]: "Failed",
  [ScenarioRunStatus.CANCELLED]: "Cancelled",
  [ScenarioRunStatus.STALLED]: "Stalled",
  [ScenarioRunStatus.IN_PROGRESS]: "Running",
  [ScenarioRunStatus.PENDING]: "Pending",
  [ScenarioRunStatus.QUEUED]: "Queued",
  [ScenarioRunStatus.RUNNING]: "Running",
  [ScenarioRunStatus.PENDING_EVALUATION]: "Evaluating",
};

const TERMINAL_WITH_CRITERIA: Set<ScenarioRunStatus> = new Set([
  ScenarioRunStatus.SUCCESS,
  ScenarioRunStatus.FAILED,
  ScenarioRunStatus.ERROR,
]);

/**
 * Formats a scenario run status into a display label with optional
 * criteria count: terminal statuses show "Passed"/"Failed" with counts
 * when available; non-terminal statuses return their label as-is.
 */
export function formatRunStatusLabel({ status, results }: FormatRunStatusLabelInput): string {
  const label = STATUS_LABELS[status];

  if (!TERMINAL_WITH_CRITERIA.has(status) || !results) {
    return label;
  }

  const met = results.metCriteria.length;
  const total = met + results.unmetCriteria.length;

  if (total === 0) {
    return label;
  }

  return `${label} (${met}/${total})`;
}
