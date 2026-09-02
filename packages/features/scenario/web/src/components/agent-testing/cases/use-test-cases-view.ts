/**
 * What the Test cases tab shows for the current selection: the suite it names,
 * the rows under it, the label filter, and the cases of an external set.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { useCallback, useMemo, useState } from "react";
import type { Period } from "@langwatch/analytics-web/components/PeriodSelector";
import type { AgentTestingSelection } from "../use-agent-testing-routing";
import type { ExternalCaseRow } from "./cases-panel";
import {
  type CaseGroup,
  filterCasesByLabels,
  groupCasesByFolder,
  type TestCase,
  type TestSuiteEntry,
} from "./test-cases";
import { useExternalSetCases } from "./use-test-cases-data";

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
}: CaseGroupsOptions): CaseGroup[] {
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
        ? [
            {
              id: selectedSuite?.id ?? "",
              name: selectedSuite?.name ?? "",
              cases: visibleCases,
            },
          ]
        : groupCasesByFolder({ cases: visibleCases, suites }),
    [selection, selectedSuite, visibleCases, suites],
  );
}

export type TestCasesView = {
  selectedSuite: TestSuiteEntry | null;
  groups: CaseGroup[];
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

  const groups = useCaseGroups({
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
    groups,
    externalSetId,
    externalCases,
    isExternalLoading,
    activeLabels,
    toggleLabel,
  };
}
