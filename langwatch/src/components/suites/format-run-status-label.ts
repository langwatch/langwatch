/**
 * Pure formatting function for scenario run status labels.
 *
 * Converts raw status + evaluation results into a human-readable label
 * like "passed (4/5)" or "failed (3/5)". Non-terminal statuses return
 * their existing labels unchanged.
 *
 * @see specs/features/suites/suite-list-view-status.feature
 */

import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { RunGroupSummary } from "./run-history-transforms";

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

/**
 * Formats a batch/group summary into a display label with scenario counts.
 *
 * Shows "passed (4/5)" or "failed (3/5)" where the numbers represent
 * how many scenarios passed out of total finished scenarios.
 * Non-terminal summaries (all in-progress) return "running".
 */
export function formatSummaryStatusLabel(summary: RunGroupSummary): string {
  const finishedCount =
    summary.passedCount +
    summary.failedCount +
    summary.stalledCount +
    summary.cancelledCount;

  if (finishedCount === 0) {
    if (summary.inProgressCount > 0) return "running";
    return "pending";
  }

  const label = summary.failedCount > 0 ? "failed" : "passed";
  return `${label} (${summary.passedCount}/${finishedCount})`;
}
