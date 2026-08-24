/**
 * Everything the Test cases tab reads: the test suites, the cases, the sets
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
import { api } from "~/utils/api";
import type { CaseLastResult } from "./CasesTable";
import type { ExternalSetEntry, TestCase, TestSuiteEntry } from "./test-cases";

export type TestCasesData = {
  suites: TestSuiteEntry[];
  cases: TestCase[];
  externalSets: ExternalSetEntry[];
  lastResults: Map<string, CaseLastResult>;
  isLastResultsLoading: boolean;
  /** The suites that have a run inside the period, so Open last run is offered. */
  suiteIdsWithRuns: Set<string>;
  authorNameById: Record<string, string>;
  isLoading: boolean;
};

export function useTestCasesData({
  period,
}: {
  period: Period;
}): TestCasesData {
  const { project, organization } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const startDate = period.startDate.getTime();
  const endDate = period.endDate.getTime();

  const { data: folders, isLoading: isFoldersLoading } =
    api.suites.folders.getAll.useQuery({ projectId }, { enabled: !!project });

  const { data: scenarios, isLoading: isScenariosLoading } =
    api.scenarios.getAll.useQuery({ projectId }, { enabled: !!project });

  const { data: externalSetSummaries } =
    api.scenarios.getExternalSetSummaries.useQuery(
      { projectId, startDate, endDate },
      { enabled: !!project },
    );

  const { data: lastResultRows, isLoading: isLastResultsLoading } =
    api.scenarios.getLastResultSummaries.useQuery(
      { projectId, startDate, endDate },
      { enabled: !!project },
    );

  const { data: suiteSummaries } = api.suites.getSummaries.useQuery(
    { projectId, startDate, endDate },
    { enabled: !!project },
  );

  // Only to put a name on the "Added" cell. A project whose members cannot be
  // read shows the date alone rather than failing the table.
  const { data: organizationMembers } =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      { organizationId: organization?.id ?? "" },
      { enabled: !!organization?.id },
    );

  const cases = useMemo<TestCase[]>(
    () =>
      (scenarios ?? []).map((scenario) => ({
        id: scenario.id,
        name: scenario.name,
        labels: scenario.labels,
        folderId: scenario.folderId,
        createdAt: new Date(scenario.createdAt),
        lastUpdatedById: scenario.lastUpdatedById,
      })),
    [scenarios],
  );

  const suites = useMemo<TestSuiteEntry[]>(() => {
    const countByFolder = new Map<string, number>();
    for (const testCase of cases) {
      if (!testCase.folderId) continue;
      countByFolder.set(
        testCase.folderId,
        (countByFolder.get(testCase.folderId) ?? 0) + 1,
      );
    }
    return (folders ?? []).map((folder) => ({
      id: folder.id,
      name: folder.name,
      slug: folder.slug,
      caseCount: countByFolder.get(folder.id) ?? 0,
    }));
  }, [folders, cases]);

  const externalSets = useMemo<ExternalSetEntry[]>(
    () =>
      (externalSetSummaries ?? []).map((set) => ({
        setId: set.scenarioSetId,
        lastRunTimestamp: set.lastRunTimestamp,
      })),
    [externalSetSummaries],
  );

  const lastResults = useMemo<Map<string, CaseLastResult>>(() => {
    const byScenario = new Map<string, CaseLastResult>();
    for (const row of lastResultRows ?? []) byScenario.set(row.scenarioId, row);
    return byScenario;
  }, [lastResultRows]);

  const suiteIdsWithRuns = useMemo(() => {
    const withRuns = new Set<string>();
    for (const [suiteId, summary] of Object.entries(suiteSummaries ?? {})) {
      if (summary.lastRunTimestamp) withRuns.add(suiteId);
    }
    return withRuns;
  }, [suiteSummaries]);

  const authorNameById = useMemo<Record<string, string>>(() => {
    const names: Record<string, string> = {};
    for (const member of organizationMembers?.members ?? []) {
      if (member.user.name) names[member.user.id] = member.user.name;
    }
    return names;
  }, [organizationMembers]);

  return {
    suites,
    cases,
    externalSets,
    lastResults,
    isLastResultsLoading,
    suiteIdsWithRuns,
    authorNameById,
    isLoading: isFoldersLoading || isScenariosLoading,
  };
}

/**
 * The test cases of a set that runs from code. The set holds no case records,
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
