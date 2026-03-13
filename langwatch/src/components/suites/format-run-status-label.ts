/**
 * Pure formatting functions for scenario run status labels.
 *
 * Converts raw status + evaluation results into human-readable labels.
 * Individual run labels include criteria counts (e.g. "passed (4/5)").
 *
 * @see specs/features/suites/suite-list-view-status.feature
 */

import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";

type CriteriaResults = {
  metCriteria: string[];
  unmetCriteria: string[];
};

type FormatRunStatusLabelInput = {
  status: ScenarioRunStatus;
  results?: CriteriaResults | null;
};

const STATUS_LABELS: Record<ScenarioRunStatus, string> = {
  [ScenarioRunStatus.SUCCESS]: "passed",
  [ScenarioRunStatus.FAILED]: "failed",
  [ScenarioRunStatus.ERROR]: "failed",
  [ScenarioRunStatus.CANCELLED]: "cancelled",
  [ScenarioRunStatus.STALLED]: "stalled",
  [ScenarioRunStatus.IN_PROGRESS]: "running",
  [ScenarioRunStatus.PENDING]: "pending",
  [ScenarioRunStatus.QUEUED]: "queued",
  [ScenarioRunStatus.RUNNING]: "running",
};

const TERMINAL_WITH_CRITERIA: Set<ScenarioRunStatus> = new Set([
  ScenarioRunStatus.SUCCESS,
  ScenarioRunStatus.FAILED,
  ScenarioRunStatus.ERROR,
]);

/**
 * Formats a scenario run status into a display label with optional criteria count.
 *
 * Terminal statuses (success, failed, error) show "passed" or "failed" with
 * criteria count in parentheses when criteria exist, e.g. "passed (4/5)".
 * Non-terminal statuses return their label as-is: "running", "pending", etc.
 */
export function formatRunStatusLabel({
  status,
  results,
}: FormatRunStatusLabelInput): string {
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