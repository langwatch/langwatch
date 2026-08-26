/**
 * What the Scenarios tab shows for the current selection: the suite it names,
 * the rows under it, the label filter, and the cases of an external set.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { useCallback, useMemo, useState } from "react";
import type { Period } from "~/components/PeriodSelector";
import type { AgentTestingSelection } from "../useAgentTestingRouting";
import type { ExternalCaseRow } from "./CasesPanel";
import {
  type CaseGroup,
  type CasesRoot,
  filterCasesByLabels,
  groupCasesByFolder,
  type TestCase,
  type TestSuiteEntry,
} from "./test-cases";
import { useExternalSetCases } from "./useTestCasesData";

type CaseGroupsOptions = {
  cases: TestCase[];
  suites: TestSuiteEntry[];
  selection: AgentTestingSelection;
  selectedSuite: TestSuiteEntry | null;
  activeLabels: string[];
};

/** The rows the table draws, scoped to the selection and the label filter. */
function useCaseGroups({
  cases,
  suites,
  selection,
  selectedSuite,
  activeLabels,
}: CaseGroupsOptions): CasesRoot {
  const visibleCases = useMemo(() => {
    const scoped =
      selection.kind === "suite"
        ? cases.filter((testCase) => testCase.folderId === selectedSuite?.id)
        : cases;
    return filterCasesByLabels(scoped, activeLabels);
  }, [cases, selection, selectedSuite, activeLabels]);

  return useMemo(
    () =>
      selection.kind === "suite"
        ? { folderGroups: [], looseCases: visibleCases }
        : groupCasesByFolder({
            cases: visibleCases,
            suites,
            // On the All scenarios surface, every suite gets a folder row,
            // even one that holds no case yet, so a person can open it from
            // the table. A label filter is a scope on the cases themselves,
            // so an empty folder under a filter still drops off.
            includeEmpty: activeLabels.length === 0,
          }),
    [selection, visibleCases, suites, activeLabels.length],
  );
}

export type TestCasesView = {
  selectedSuite: TestSuiteEntry | null;
  folderGroups: CaseGroup[];
  looseCases: TestCase[];
  /** The id of the selected external set, or the empty string. */
  externalSetId: string;
  externalCases: ExternalCaseRow[];
  isExternalLoading: boolean;
  activeLabels: string[];
  toggleLabel: (label: string) => void;
};

export function useTestCasesView({
  selection,
  period,
  suites,
  cases,
}: {
  selection: AgentTestingSelection;
  period: Period;
  suites: TestSuiteEntry[];
  cases: TestCase[];
}): TestCasesView {
  const [activeLabels, setActiveLabels] = useState<string[]>([]);
  const externalSetId = selection.kind === "external" ? selection.setId : "";

  const { cases: externalCases, isLoading: isExternalLoading } =
    useExternalSetCases({
      setId: externalSetId,
      period,
      enabled: selection.kind === "external",
    });

  const selectedSuite = useMemo<TestSuiteEntry | null>(() => {
    if (selection.kind !== "suite") return null;
    return suites.find((suite) => suite.slug === selection.slug) ?? null;
  }, [selection, suites]);

  const { folderGroups, looseCases } = useCaseGroups({
    cases,
    suites,
    selection,
    selectedSuite,
    activeLabels,
  });

  const toggleLabel = useCallback((label: string) => {
    setActiveLabels((current) =>
      current.includes(label)
        ? current.filter((entry) => entry !== label)
        : [...current, label],
    );
  }, []);

  return {
    selectedSuite,
    folderGroups,
    looseCases,
    externalSetId,
    externalCases,
    isExternalLoading,
    activeLabels,
    toggleLabel,
  };
}
