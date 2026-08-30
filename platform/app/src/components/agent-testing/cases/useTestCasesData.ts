/**
 * Everything the Scenarios tab reads: the test suites, the scenarios, the sets
 * that run from code, the last result of every scenario, and the names of the
 * people who wrote them.
 *
 * The scenario list and the last results are two reads on purpose. The table is
 * drawn from the list and the verdict cells fill in as the aggregate answers.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { useMemo } from "react";
import type { Period } from "~/components/PeriodSelector";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";
import type { CaseLastResult } from "./CasesTable";
import {
  type ExternalSetEntry,
  orderSuitesDefaultFirst,
  type TestCase,
  type TestSuiteEntry,
} from "./test-cases";

type ScenarioRows = RouterOutputs["scenarios"]["getAll"];
type TestSuiteRows = RouterOutputs["suites"]["testSuites"]["getAll"];
type ExternalSetRows = RouterOutputs["scenarios"]["getExternalSetSummaries"];

/**
 * The newest run that covered a scenario of one test suite, which is what
 * "Open last run" opens.
 */
export type SuiteLastRun = {
  batchRunId: string;
  /** The set the run landed in, which names the plan that holds it. */
  scenarioSetId: string;
  lastRunAt: number;
};

export type TestCasesData = {
  suites: TestSuiteEntry[];
  cases: TestCase[];
  /** False while the project has nothing to test, which day zero asks for. */
  hasAgent: boolean;
  externalSets: ExternalSetEntry[];
  lastResults: Map<string, CaseLastResult>;
  isLastResultsLoading: boolean;
  /**
   * The last run of every suite that ran inside the period. A suite missing
   * from the map has nothing to open.
   */
  lastRunBySuiteId: Map<string, SuiteLastRun>;
  /**
   * The scenarios filed under every suite. A run covered a suite when it
   * covered one of these, which is what the recent runs of a suite are read
   * from.
   */
  scenarioIdsBySuiteId: Map<string, string[]>;
  isLoading: boolean;
};

/** Every read the tab makes, still in the shape the server returned it. */
function useTestCasesQueries(period: Period) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const startDate = period.startDate.getTime();
  const endDate = period.endDate.getTime();
  const runWindow = { projectId, startDate, endDate };

  const { data: testSuites, isLoading: isTestSuitesLoading } =
    api.suites.testSuites.getAll.useQuery(
      { projectId },
      { enabled: !!project },
    );

  const { data: scenarios, isLoading: isScenariosLoading } =
    api.scenarios.getAll.useQuery({ projectId }, { enabled: !!project });

  const { data: externalSetSummaries } =
    api.scenarios.getExternalSetSummaries.useQuery(runWindow, {
      enabled: !!project,
    });

  const { data: lastResultRows, isLoading: isLastResultsLoading } =
    api.scenarios.getLastResultSummaries.useQuery(runWindow, {
      enabled: !!project,
    });

  const { data: agents, isLoading: isAgentsLoading } =
    api.agents.getAll.useQuery({ projectId }, { enabled: !!project });

  return {
    testSuites,
    scenarios,
    agents,
    externalSetSummaries,
    lastResultRows,
    isLastResultsLoading,
    // The agent list gates the day-zero question, so a page that has not read
    // it yet holds the skeleton rather than asking to connect an agent that
    // is already there.
    isLoading: isTestSuitesLoading || isScenariosLoading || isAgentsLoading,
  };
}

function useCaseEntries(scenarios: ScenarioRows | undefined): TestCase[] {
  return useMemo<TestCase[]>(
    () =>
      (scenarios ?? []).map((scenario) => ({
        id: scenario.id,
        name: scenario.name,
        labels: scenario.labels,
        testSuiteId: scenario.testSuiteId,
        createdAt: new Date(scenario.createdAt),
        lastUpdatedById: scenario.lastUpdatedById,
        version: scenario.version,
      })),
    [scenarios],
  );
}

function useSuiteEntries({
  testSuites,
  cases,
}: {
  testSuites: TestSuiteRows | undefined;
  cases: TestCase[];
}): TestSuiteEntry[] {
  return useMemo<TestSuiteEntry[]>(() => {
    const countByTestSuite = new Map<string, number>();
    for (const testCase of cases) {
      if (!testCase.testSuiteId) continue;
      countByTestSuite.set(
        testCase.testSuiteId,
        (countByTestSuite.get(testCase.testSuiteId) ?? 0) + 1,
      );
    }
    return orderSuitesDefaultFirst(
      (testSuites ?? []).map((testSuite) => ({
        id: testSuite.id,
        name: testSuite.name,
        slug: testSuite.slug,
        caseCount: countByTestSuite.get(testSuite.id) ?? 0,
      })),
    );
  }, [testSuites, cases]);
}

function useExternalSetEntries(
  summaries: ExternalSetRows | undefined,
): ExternalSetEntry[] {
  return useMemo<ExternalSetEntry[]>(
    () =>
      (summaries ?? []).map((set) => ({
        setId: set.scenarioSetId,
        lastRunTimestamp: set.lastRunTimestamp,
      })),
    [summaries],
  );
}

function useLastResultsByCase(
  rows: CaseLastResult[] | undefined,
): Map<string, CaseLastResult> {
  return useMemo<Map<string, CaseLastResult>>(() => {
    const byScenario = new Map<string, CaseLastResult>();
    for (const row of rows ?? []) byScenario.set(row.scenarioId, row);
    return byScenario;
  }, [rows]);
}

/** The newer of two runs of the same suite. */
function newerRun(
  current: SuiteLastRun | undefined,
  next: SuiteLastRun,
): SuiteLastRun {
  if (!current) return next;
  return current.lastRunAt >= next.lastRunAt ? current : next;
}

/**
 * The last run of every suite, read off the last result of each of its
 * scenarios.
 *
 * A suite is a grouping, so a run of one of its scenarios counts whatever plan
 * started it. Reading the runs from the scenarios is what makes a suite whose
 * scenarios only ran one at a time still offer its last run.
 */
function lastRunBySuite({
  cases,
  lastResults,
}: {
  cases: TestCase[];
  lastResults: Map<string, CaseLastResult>;
}): Map<string, SuiteLastRun> {
  const bySuite = new Map<string, SuiteLastRun>();
  for (const testCase of cases) {
    const suiteId = testCase.testSuiteId;
    const lastResult = lastResults.get(testCase.id);
    if (!suiteId || !lastResult) continue;
    bySuite.set(
      suiteId,
      newerRun(bySuite.get(suiteId), {
        batchRunId: lastResult.batchRunId,
        scenarioSetId: lastResult.scenarioSetId,
        lastRunAt: lastResult.lastRunAt,
      }),
    );
  }
  return bySuite;
}

/** The scenarios of every suite, keyed by suite id. */
function useScenarioIdsBySuite(cases: TestCase[]): Map<string, string[]> {
  return useMemo(() => {
    const bySuite = new Map<string, string[]>();
    for (const testCase of cases) {
      const suiteId = testCase.testSuiteId;
      if (!suiteId) continue;
      const filed = bySuite.get(suiteId);
      if (filed) filed.push(testCase.id);
      else bySuite.set(suiteId, [testCase.id]);
    }
    return bySuite;
  }, [cases]);
}

function useLastRunBySuite({
  cases,
  lastResults,
}: {
  cases: TestCase[];
  lastResults: Map<string, CaseLastResult>;
}): Map<string, SuiteLastRun> {
  return useMemo(
    () => lastRunBySuite({ cases, lastResults }),
    [cases, lastResults],
  );
}

export function useTestCasesData({
  period,
}: {
  period: Period;
}): TestCasesData {
  const queries = useTestCasesQueries(period);
  const cases = useCaseEntries(queries.scenarios);
  const suites = useSuiteEntries({ testSuites: queries.testSuites, cases });
  const externalSets = useExternalSetEntries(queries.externalSetSummaries);
  const lastResults = useLastResultsByCase(queries.lastResultRows);
  const lastRunBySuiteId = useLastRunBySuite({ cases, lastResults });
  const scenarioIdsBySuiteId = useScenarioIdsBySuite(cases);

  return {
    cases,
    suites,
    hasAgent: (queries.agents ?? []).length > 0,
    externalSets,
    lastResults,
    isLastResultsLoading: queries.isLastResultsLoading,
    lastRunBySuiteId,
    scenarioIdsBySuiteId,
    isLoading: queries.isLoading,
  };
}

/**
 * The scenarios of a set that runs from code. The set holds no scenario records,
 * so the names come from the runs it produced.
 */
export function useExternalSetCases({
  setId,
  period,
  enabled,
}: {
  setId: string;
  period: Period;
  enabled: boolean;
}): {
  cases: { scenarioId: string; name: string; lastRunAt: number }[];
  isLoading: boolean;
} {
  const { project } = useOrganizationTeamProject();

  const { data, isLoading } = api.scenarios.getScenarioSetRunData.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId: setId,
      limit: 100,
      startDate: period.startDate.getTime(),
      endDate: period.endDate.getTime(),
    },
    { enabled: enabled && !!project && !!setId },
  );

  const cases = useMemo(() => {
    const newestByScenario = new Map<
      string,
      { scenarioId: string; name: string; lastRunAt: number }
    >();
    for (const run of data?.runs ?? []) {
      const current = newestByScenario.get(run.scenarioId);
      if (current && current.lastRunAt >= run.timestamp) continue;
      newestByScenario.set(run.scenarioId, {
        scenarioId: run.scenarioId,
        name: run.name ?? run.scenarioId,
        lastRunAt: run.timestamp,
      });
    }
    return Array.from(newestByScenario.values()).sort(
      (left, right) => right.lastRunAt - left.lastRunAt,
    );
  }, [data]);

  return { cases, isLoading };
}
