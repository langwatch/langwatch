/**
 * What sits under the cases panel header: the skeleton, an empty state, or
 * the table with the last-run line beneath it. The bulk selection action bar
 * lives here too, so the selection state does not leak into the tab model.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { useCallback, useMemo, useState } from "react";
import {
  ExternalSetEmptyState,
  FirstCaseEmptyState,
  NoCasesHereEmptyState,
} from "./CasesEmptyStates";
import type { CasesPanelProps } from "./CasesPanel";
import {
  CasesTable,
  CasesTableSkeleton,
  ExternalCasesTable,
} from "./CasesTable";
import { LastRunLine } from "./LastRunLine";
import { MoveToSuiteSelectionBar } from "./MoveToSuiteSelectionBar";
import type { TestCase } from "./test-cases";

export type CasesPanelBodyProps = CasesPanelProps & {
  /** True for a set that runs from code, which the platform cannot write. */
  isExternal: boolean;
  caseCount: number;
};

/** All cases across every group of the table, from the flat view. */
function flattenGroupCases(props: CasesPanelBodyProps): TestCase[] {
  return props.groups.flatMap((group) => group.cases);
}

function useCaseSelection(flatCases: TestCase[], props: CasesPanelBodyProps) {
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
    (targetSuiteId: string | null) => {
      for (const id of selectedIds) {
        const testCase = flatCases.find((entry) => entry.id === id);
        if (!testCase) continue;
        props.onMoveToSuite(testCase, targetSuiteId);
      }
      clearSelection();
    },
    [selectedIds, flatCases, props, clearSelection],
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

export function CasesPanelBody(props: CasesPanelBodyProps) {
  const flatCases = useMemo(() => flattenGroupCases(props), [props]);
  const {
    selectedIds,
    isSelectionMode,
    toggleSelected,
    startMoveToSuite,
    clearSelection,
    handleMoveConfirm,
  } = useCaseSelection(flatCases, props);

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

  if (props.caseCount === 0) {
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
        groups={props.groups}
        showGroupHeadings={props.selection.kind === "all"}
        lastResults={props.lastResults}
        isLastResultsLoading={props.isLastResultsLoading}
        suites={props.suites}
        canManage={props.canManage}
        runningCaseId={props.runningCaseId}
        isSelectionMode={isSelectionMode}
        selectedIds={selectedIds}
        onToggleSelected={toggleSelected}
        onStartMoveToSuite={startMoveToSuite}
        onSelectSuite={props.onSelectSuite}
        onRowClick={props.onRowClick}
        onRunCase={props.onRunCase}
        onEdit={props.onEdit}
        onHistory={props.onHistory}
        onDuplicate={props.onDuplicate}
        onOpenLastRun={props.onOpenLastRun}
        onArchive={props.onArchive}
      />
      <LastRunLine
        selection={props.selection}
        groups={props.groups}
        lastResults={props.lastResults}
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
