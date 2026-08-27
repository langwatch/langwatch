/**
 * What sits under the cases panel header: the skeleton, an empty state, or
 * the table with the recent runs control beneath it. The bulk selection
 * action bar lives here too, so the selection state does not leak into the
 * tab model.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { useCallback, useState } from "react";
import {
  ConnectAgentEmptyState,
  ExternalSetEmptyState,
  FirstCaseEmptyState,
  FirstSuiteEmptyState,
  NoCasesHereEmptyState,
} from "./CasesEmptyStates";
import type { CasesPanelProps } from "./CasesPanel";
import {
  CasesTable,
  CasesTableSkeleton,
  ExternalCasesTable,
} from "./CasesTable";
import { MoveToSuiteSelectionBar } from "./MoveToSuiteSelectionBar";
import { RecentRunsMenu } from "./RecentRunsMenu";
import type { TestCase } from "./test-cases";

export type CasesPanelBodyProps = CasesPanelProps & {
  /** True for a set that runs from code, which the platform cannot write. */
  isExternal: boolean;
};

function useCaseSelection({
  cases,
  onMoveToSuite,
}: {
  cases: TestCase[];
  onMoveToSuite: (testCase: TestCase, suiteId: string) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelected = useCallback((scenarioId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(scenarioId)) next.delete(scenarioId);
      else next.add(scenarioId);
      return next;
    });
  }, []);

  const startMoveToSuite = useCallback((scenarioId: string) => {
    setSelectedIds(new Set([scenarioId]));
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const handleMoveConfirm = useCallback(
    (targetSuiteId: string) => {
      for (const id of selectedIds) {
        const testCase = cases.find((entry) => entry.id === id);
        if (!testCase) continue;
        onMoveToSuite(testCase, targetSuiteId);
      }
      clearSelection();
    },
    [selectedIds, cases, onMoveToSuite, clearSelection],
  );

  return {
    selectedIds,
    isSelectionMode: selectedIds.size > 0,
    toggleSelected,
    startMoveToSuite,
    clearSelection,
    handleMoveConfirm,
  };
}

/**
 * The one question the recent runs list answers, asked off the last results
 * the table already holds: has a scenario of this suite run inside the period.
 * The control under the table is never offered over a list with no rows.
 */
function hasRunInPeriod(props: CasesPanelBodyProps): boolean {
  return props.suiteScenarioIds.some((scenarioId) =>
    props.lastResults.has(scenarioId),
  );
}

/**
 * Day zero, in the order a person can act on it: an agent to test comes
 * before a suite to file scenarios into, and a suite comes before a scenario.
 */
function DayZeroEmptyState(props: CasesPanelBodyProps) {
  if (!props.hasAgent) {
    return (
      <ConnectAgentEmptyState
        canManage={props.canManage}
        onConnectAgent={props.onConnectAgent}
      />
    );
  }
  return (
    <FirstSuiteEmptyState
      canManage={props.canManage}
      onNewSuite={props.onNewSuite}
    />
  );
}

export function CasesPanelBody(props: CasesPanelBodyProps) {
  const {
    selectedIds,
    isSelectionMode,
    toggleSelected,
    startMoveToSuite,
    clearSelection,
    handleMoveConfirm,
  } = useCaseSelection({
    cases: props.cases,
    onMoveToSuite: props.onMoveToSuite,
  });
  const hasLastRunByCase = useCallback(
    (scenarioId: string) => props.lastResults.has(scenarioId),
    [props.lastResults],
  );

  if (props.isLoading) return <CasesTableSkeleton />;

  if (props.isExternal) {
    if (props.externalCases.length === 0) return <ExternalSetEmptyState />;
    return (
      <ExternalCasesTable
        cases={props.externalCases}
        onRowClick={props.onOpenExternalCase}
      />
    );
  }

  if (!props.suite) return <DayZeroEmptyState {...props} />;

  if (props.cases.length === 0) {
    return props.projectHasNoCases ? (
      <FirstCaseEmptyState
        canManage={props.canManage}
        onNewTestCase={props.onNewTestCase}
      />
    ) : (
      <NoCasesHereEmptyState />
    );
  }

  return (
    <>
      <CasesTable
        cases={props.cases}
        canManage={props.canManage}
        isSelectionMode={isSelectionMode}
        selectedIds={selectedIds}
        hasLastRunByCase={hasLastRunByCase}
        onToggleSelected={toggleSelected}
        onStartMoveToSuite={startMoveToSuite}
        onRowClick={props.onRowClick}
        onRunCase={props.onRunCase}
        onEdit={props.onEdit}
        onHistory={props.onHistory}
        onDuplicate={props.onDuplicate}
        onOpenLastRun={props.onOpenLastRun}
        onArchive={props.onArchive}
      />
      <RecentRunsMenu
        period={props.period}
        scenarioIds={props.suiteScenarioIds}
        hasRun={hasRunInPeriod(props)}
      />
      <MoveToSuiteSelectionBar
        selectedCount={selectedIds.size}
        suites={props.suites}
        onClear={clearSelection}
        onConfirm={handleMoveConfirm}
      />
    </>
  );
}
