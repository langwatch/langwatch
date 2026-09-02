/**
 * What sits under the cases panel header: the skeleton, an empty state, or
 * the table with the last-run line beneath it.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import {
  ExternalSetEmptyState,
  FirstCaseEmptyState,
  NoCasesHereEmptyState,
} from "./cases-empty-states";
import type { CasesPanelProps } from "./cases-panel";
import {
  CasesTable,
  CasesTableSkeleton,
  ExternalCasesTable,
} from "./cases-table";
import { LastRunLine } from "./last-run-line";

export type CasesPanelBodyProps = CasesPanelProps & {
  /** True for a set that runs from code, which the platform cannot write. */
  isExternal: boolean;
  caseCount: number;
};

export function CasesPanelBody(props: CasesPanelBodyProps) {
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
        onSelectSuite={props.onSelectSuite}
        onRowClick={props.onRowClick}
        onRunCase={props.onRunCase}
        onEdit={props.onEdit}
        onHistory={props.onHistory}
        onDuplicate={props.onDuplicate}
        onMoveToSuite={props.onMoveToSuite}
        onOpenLastRun={props.onOpenLastRun}
        onArchive={props.onArchive}
      />
      <LastRunLine
        selection={props.selection}
        groups={props.groups}
        lastResults={props.lastResults}
      />
    </>
  );
}
