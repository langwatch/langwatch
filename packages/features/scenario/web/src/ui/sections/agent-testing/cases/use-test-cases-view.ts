/**
 * What the Scenarios tab shows: the suite that is open, the rows under it, the
 * label filter, and the scenarios of an external set.
 *
 * One suite is always open. Which one is resolved in a single expression: the
 * suite the address names, or the first of the rail. That one expression is
 * what serves an address naming no suite, an address naming a suite that was
 * archived, and the ordinary scenario, so none of them needs a branch of its own.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { useCallback, useMemo, useState } from "react";
import type { Period } from "@langwatch/analytics-web/components/PeriodSelector";
import type { AgentTestingSelection } from "../../../../behavior/agent-testing/use-agent-testing-routing";
import type { ExternalCaseRow } from "./cases-panel";
import {
  filterCasesByLabels,
  type TestCase,
  type TestSuiteEntry,
} from "../../../../model/agent-testing/cases/test-cases";
import { useExternalSetCases } from "./use-test-cases-data";

export type TestCasesView = {
  /** The suite that is open, or nothing while the project has none. */
  selectedSuite: TestSuiteEntry | null;
  /** The rows of the open suite, after the label filter. */
  cases: TestCase[];
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

  const { cases: externalCases, isLoading: isExternalLoading } = useExternalSetCases({
    setId: externalSetId,
    period,
    enabled: selection.kind === "external",
  });

  const selectedSuite = useMemo<TestSuiteEntry | null>(() => {
    const namedSlug = selection.kind === "suite" ? selection.slug : null;
    return suites.find((suite) => suite.slug === namedSlug) ?? suites[0] ?? null;
  }, [selection, suites]);

  const visibleCases = useMemo(() => {
    const held = cases.filter((testCase) => testCase.testSuiteId === selectedSuite?.id);
    return filterCasesByLabels(held, activeLabels);
  }, [cases, selectedSuite, activeLabels]);

  const toggleLabel = useCallback((label: string) => {
    setActiveLabels((current) =>
      current.includes(label) ? current.filter((entry) => entry !== label) : [...current, label],
    );
  }, []);

  return {
    selectedSuite,
    cases: visibleCases,
    externalSetId,
    externalCases,
    isExternalLoading,
    activeLabels,
    toggleLabel,
  };
}
