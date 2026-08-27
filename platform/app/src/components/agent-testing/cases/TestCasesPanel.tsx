/**
 * The cases panel of the Scenarios tab, wired to the tab model.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { toExternalPlanSlug } from "../results/run-plans";
import { CasesPanel } from "./CasesPanel";
import { collectLabels } from "./test-cases";
import type { TestCasesTabModel } from "./useTestCasesTab";

export function TestCasesPanel({ model }: { model: TestCasesTabModel }) {
  const { base, data, view, caseMutations, suiteDialog, run, open } = model;
  const isExternal = base.selection.kind === "external";
  const selectedSuite = view.selectedSuite;

  return (
    <CasesPanel
      selection={base.selection}
      title={isExternal ? view.externalSetId : (selectedSuite?.name ?? "")}
      cases={view.cases}
      externalCases={view.externalCases}
      isLoading={isExternal ? view.isExternalLoading : data.isLoading}
      lastResults={data.lastResults}
      isLastResultsLoading={data.isLastResultsLoading}
      suites={data.suites}
      canManage={base.canManage}
      suite={selectedSuite}
      suiteHasRun={
        !!selectedSuite && data.suiteIdsWithRuns.has(selectedSuite.id)
      }
      period={base.periodPicker.period}
      hasAgent={data.hasAgent}
      projectHasNoCases={data.cases.length === 0}
      allLabels={collectLabels(data.cases)}
      activeLabels={view.activeLabels}
      onToggleLabel={view.toggleLabel}
      runningCaseId={run.runningCaseId}
      onRunSet={run.runSelectedSuite}
      onNewTestCase={() => base.onNewTestCase(selectedSuite?.id ?? null)}
      onNewSuite={suiteDialog.openNew}
      onConnectAgent={base.onConnectAgent}
      onRowClick={open.onRowClick}
      onRunCase={run.runCase}
      onEdit={open.openEditor}
      onHistory={open.openHistory}
      onDuplicate={caseMutations.duplicateCase}
      onMoveToSuite={caseMutations.moveCaseToSuite}
      onOpenLastRun={open.openLastRun}
      onArchive={caseMutations.setCaseToArchive}
      onOpenExternalCase={() =>
        base.selectPlan(toExternalPlanSlug(view.externalSetId))
      }
      onOpenExternalResults={() =>
        base.selectPlan(toExternalPlanSlug(view.externalSetId))
      }
      onRenameSuite={() => {
        if (selectedSuite) suiteDialog.openRename(selectedSuite.id);
      }}
    />
  );
}
