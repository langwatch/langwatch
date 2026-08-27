/**
 * The scenarios of a project, and the rules that filter and summarise them.
 *
 * Everything here is pure, so the filtering and the aggregates can be read and
 * tested without a router or a query.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/scenarios/scenario-folder-assignment.feature
 */

import type { RunGroupSummary } from "~/components/suites/run-history-transforms";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioLastResultSummary } from "~/server/scenarios/scenario-event.types";
import type { SuiteTarget } from "~/server/suites/types";

/** A scenario as the table reads it. */
export type TestCase = {
  id: string;
  name: string;
  labels: string[];
  folderId: string | null;
  createdAt: Date;
  /** The person who last saved the case, when the project knows their name. */
  lastUpdatedById: string | null;
  /** The stored version of the case; each save moves it up by one. */
  version?: number;
};

/** A test suite as the rail and the table read it. */
export type TestSuiteEntry = {
  id: string;
  name: string;
  slug: string;
  caseCount: number;
  /**
   * The agents the last run of this suite chose, persisted on the suite row
   * so the run dialog preselects them.
   */
  targets?: SuiteTarget[];
};

/** A set that a code run writes into. It is read-only in the platform. */
export type ExternalSetEntry = {
  setId: string;
  lastRunTimestamp: number | null;
};

/**
 * The name the Default suite carries, kept in step with
 * `DEFAULT_SUITE_NAME` in `~/server/suites/default-suite`, which is what
 * writes it. The name is read and never written here, so this module stays
 * free of the Prisma the server module needs.
 */
export const DEFAULT_SUITE_NAME = "Default";

/**
 * The suites of the rail, with Default at the front.
 *
 * Default is an ordinary suite in every other way, so it is only moved and
 * never marked. Existing projects got theirs from the migration, which makes
 * it the newest row of the list rather than the first, and a person who
 * renames it has an ordinary suite that keeps its place in the list.
 */
export function orderSuitesDefaultFirst(
  suites: TestSuiteEntry[],
): TestSuiteEntry[] {
  const isDefault = (suite: TestSuiteEntry) =>
    suite.name === DEFAULT_SUITE_NAME;
  return [...suites.filter(isDefault), ...suites.filter((s) => !isDefault(s))];
}

/** The cases that carry at least one of the chosen labels. */
export function filterCasesByLabels(
  cases: TestCase[],
  activeLabels: string[],
): TestCase[] {
  if (activeLabels.length === 0) return cases;
  return cases.filter((testCase) =>
    activeLabels.some((label) => testCase.labels.includes(label)),
  );
}

/** Every label used by any of the cases, in reading order. */
export function collectLabels(cases: TestCase[]): string[] {
  const labels = new Set<string>();
  for (const testCase of cases) {
    for (const label of testCase.labels) labels.add(label);
  }
  return Array.from(labels).sort();
}

const PASSED_STATUSES: ReadonlySet<ScenarioRunStatus> = new Set([
  ScenarioRunStatus.SUCCESS,
]);

const FAILED_STATUSES: ReadonlySet<ScenarioRunStatus> = new Set([
  ScenarioRunStatus.FAILED,
  ScenarioRunStatus.ERROR,
]);

/**
 * How a group of cases did, from the last result of each of them.
 *
 * The shape is the one RunMetricsSummary reads. Duration and cost stay empty:
 * the last-result read carries a verdict per case, not the metrics of a run.
 */
export function summaryFromLastResults(
  results: ScenarioLastResultSummary[],
): RunGroupSummary {
  let passedCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;
  let inProgressCount = 0;

  for (const result of results) {
    if (PASSED_STATUSES.has(result.status)) passedCount++;
    else if (FAILED_STATUSES.has(result.status)) failedCount++;
    else if (result.status === ScenarioRunStatus.CANCELLED) cancelledCount++;
    else inProgressCount++;
  }

  const completedCount = passedCount + failedCount;

  return {
    passRate: completedCount > 0 ? (passedCount / completedCount) * 100 : null,
    passedCount,
    failedCount,
    stalledCount: 0,
    cancelledCount,
    completedCount,
    totalCount: results.length,
    inProgressCount,
    queuedCount: 0,
    totalCost: null,
    averageAgentLatencyMs: null,
    totalDurationMs: null,
    agentLatencyStats: null,
    agentCostStats: null,
    averageAgentCost: null,
  };
}

/** The newest run time among a set of last results, or nothing. */
export function lastRunAtOf(
  results: ScenarioLastResultSummary[],
): number | null {
  let latest: number | null = null;
  for (const result of results) {
    if (latest === null || result.lastRunAt > latest) latest = result.lastRunAt;
  }
  return latest;
}
