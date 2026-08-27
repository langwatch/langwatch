/**
 * Everything the Scenarios tab reads: the test suites, the cases, the sets
 * that run from code, the last result of every case, and the names of the
 * people who wrote them.
 *
 * The case list and the last results are two reads on purpose. The table is
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
type FolderRows = RouterOutputs["suites"]["folders"]["getAll"];
type ExternalSetRows = RouterOutputs["scenarios"]["getExternalSetSummaries"];
type SuiteSummaries = RouterOutputs["suites"]["getSummaries"];

export type TestCasesData = {
  suites: TestSuiteEntry[];
  cases: TestCase[];
  /** False while the project has nothing to test, which day zero asks for. */
  hasAgent: boolean;
  externalSets: ExternalSetEntry[];
  lastResults: Map<string, CaseLastResult>;
  isLastResultsLoading: boolean;
  /** The suites that have a run inside the period, so Open last run is offered. */
  suiteIdsWithRuns: Set<string>;
  isLoading: boolean;
};

/** Every read the tab makes, still in the shape the server returned it. */
function useTestCasesQueries(period: Period) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const startDate = period.startDate.getTime();
  const endDate = period.endDate.getTime();
  const runWindow = { projectId, startDate, endDate };

  const { data: folders, isLoading: isFoldersLoading } =
    api.suites.folders.getAll.useQuery({ projectId }, { enabled: !!project });

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

  const { data: suiteSummaries } = api.suites.getSummaries.useQuery(runWindow, {
    enabled: !!project,
  });

  const { data: agents, isLoading: isAgentsLoading } =
    api.agents.getAll.useQuery({ projectId }, { enabled: !!project });

  return {
    folders,
    scenarios,
    agents,
    externalSetSummaries,
    lastResultRows,
    suiteSummaries,
    isLastResultsLoading,
    // The agent list gates the day-zero question, so a page that has not read
    // it yet holds the skeleton rather than asking to connect an agent that
    // is already there.
    isLoading: isFoldersLoading || isScenariosLoading || isAgentsLoading,
  };
}

function useCaseEntries(scenarios: ScenarioRows | undefined): TestCase[] {
  return useMemo<TestCase[]>(
    () =>
      (scenarios ?? []).map((scenario) => ({
        id: scenario.id,
        name: scenario.name,
        labels: scenario.labels,
        folderId: scenario.folderId,
        createdAt: new Date(scenario.createdAt),
        lastUpdatedById: scenario.lastUpdatedById,
        version: scenario.version,
      })),
    [scenarios],
  );
}

function useSuiteEntries({
  folders,
  cases,
}: {
  folders: FolderRows | undefined;
  cases: TestCase[];
}): TestSuiteEntry[] {
  return useMemo<TestSuiteEntry[]>(() => {
    const countByFolder = new Map<string, number>();
    for (const testCase of cases) {
      if (!testCase.folderId) continue;
      countByFolder.set(
        testCase.folderId,
        (countByFolder.get(testCase.folderId) ?? 0) + 1,
      );
    }
    return orderSuitesDefaultFirst(
      (folders ?? []).map((folder) => ({
        id: folder.id,
        name: folder.name,
        slug: folder.slug,
        caseCount: countByFolder.get(folder.id) ?? 0,
      })),
    );
  }, [folders, cases]);
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

function useSuiteIdsWithRuns(
  summaries: SuiteSummaries | undefined,
): Set<string> {
  return useMemo(() => {
    const withRuns = new Set<string>();
    for (const [suiteId, summary] of Object.entries(summaries ?? {})) {
      if (summary.lastRunTimestamp) withRuns.add(suiteId);
    }
    return withRuns;
  }, [summaries]);
}

export function useTestCasesData({
  period,
}: {
  period: Period;
}): TestCasesData {
  const queries = useTestCasesQueries(period);
  const cases = useCaseEntries(queries.scenarios);
  const suites = useSuiteEntries({ folders: queries.folders, cases });
  const externalSets = useExternalSetEntries(queries.externalSetSummaries);
  const lastResults = useLastResultsByCase(queries.lastResultRows);
  const suiteIdsWithRuns = useSuiteIdsWithRuns(queries.suiteSummaries);

  return {
    cases,
    suites,
    hasAgent: (queries.agents ?? []).length > 0,
    externalSets,
    lastResults,
    isLastResultsLoading: queries.isLastResultsLoading,
    suiteIdsWithRuns,
    isLoading: queries.isLoading,
  };
}

/**
 * The scenarios of a set that runs from code. The set holds no case records,
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
