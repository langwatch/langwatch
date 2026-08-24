/**
 * The test cases of a project, and the rules that group and filter them.
 *
 * Everything here is pure, so the grouping and the aggregates can be read and
 * tested without a router or a query.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/scenarios/scenario-folder-assignment.feature
 */

import type { RunGroupSummary } from "~/components/suites/run-history-transforms";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioLastResultSummary } from "~/server/scenarios/scenario-event.types";
import type { SuiteTarget } from "~/server/suites/types";

/** The group that holds every case filed in no test suite. */
export const UNFILED_GROUP_ID = "__unfiled__" as const;
export const UNFILED_GROUP_NAME = "Unfiled test cases";

/** A test case as the table reads it. */
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

/** One group of rows under one heading. */
export type CaseGroup = {
  /** The folder id, or UNFILED_GROUP_ID for the unfiled group. */
  id: string;
  name: string;
  cases: TestCase[];
};

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

/**
 * The rows of the All test cases view, grouped under their test suite.
 *
 * A suite that holds none of the listed cases is left out, so a label filter
 * hides the headings it empties. The unfiled cases are always the last group.
 */
export function groupCasesByFolder({
  cases,
  suites,
}: {
  cases: TestCase[];
  suites: TestSuiteEntry[];
}): CaseGroup[] {
  const byFolder = new Map<string, TestCase[]>();
  const unfiled: TestCase[] = [];

  for (const testCase of cases) {
    if (!testCase.folderId) {
      unfiled.push(testCase);
      continue;
    }
    const bucket = byFolder.get(testCase.folderId);
    if (bucket) bucket.push(testCase);
    else byFolder.set(testCase.folderId, [testCase]);
  }

  const groups: CaseGroup[] = [];
  for (const suite of suites) {
    const held = byFolder.get(suite.id);
    if (!held || held.length === 0) continue;
    groups.push({ id: suite.id, name: suite.name, cases: held });
    byFolder.delete(suite.id);
  }

  // A case can name a folder the rail does not list, for example one that was
  // archived while the page was open. Those cases read as unfiled rather than
  // disappearing from the table.
  for (const orphans of byFolder.values()) unfiled.push(...orphans);

  if (unfiled.length > 0) {
    groups.push({
      id: UNFILED_GROUP_ID,
      name: UNFILED_GROUP_NAME,
      cases: unfiled,
    });
  }

  return groups;
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

/** The criteria counts of a last result, in the shape LastResultLabel reads. */
export function criteriaOf(result: ScenarioLastResultSummary): {
  metCriteria: string[];
  unmetCriteria: string[];
} {
  return {
    metCriteria: new Array<string>(result.metCriteriaCount).fill(""),
    unmetCriteria: new Array<string>(result.unmetCriteriaCount).fill(""),
  };
}
