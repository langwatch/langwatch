/**
 * The cases panel of the Test cases tab, wired to the tab model.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { useDrawer } from "~/hooks/useDrawer";
import { toExternalPlanSlug } from "../results/run-plans";
import { SUITE_EDITOR_DRAWER } from "./AgentTestingSuiteEditorDrawer";
import { CasesPanel } from "./CasesPanel";
import { collectLabels } from "./test-cases";
import type { TestCasesTabModel } from "./useTestCasesTab";

/** The name of the selected set, as the panel header reads it. */
function panelTitle({ base, view }: TestCasesTabModel): string {
  if (base.selection.kind === "all") return "All test cases";
  if (base.selection.kind === "suite") {
    return view.selectedSuite?.name ?? "Test suite";
  }
  return view.externalSetId;
}

export function TestCasesPanel({ model }: { model: TestCasesTabModel }) {
  const { base, data, view, caseMutations, run, open } = model;
  const isExternal = base.selection.kind === "external";
  const { openDrawer } = useDrawer();

  return (
    <CasesPanel
      selection={base.selection}
      title={panelTitle(model)}
      groups={view.groups}
      externalCases={view.externalCases}
      isLoading={isExternal ? view.isExternalLoading : data.isLoading}
      lastResults={data.lastResults}
      isLastResultsLoading={data.isLastResultsLoading}
      suites={data.suites}
      canManage={base.canManage}
      projectHasNoCases={data.cases.length === 0}
      allLabels={collectLabels(data.cases)}
      activeLabels={view.activeLabels}
      onToggleLabel={view.toggleLabel}
      runningCaseId={run.runningCaseId}
      onRunSet={run.runSelectedSet}
      onNewTestCase={() => base.onNewTestCase(view.selectedSuite?.id ?? null)}
      onSelectSuite={(suiteId) => {
        const suite = data.suites.find((entry) => entry.id === suiteId);
        if (suite) base.selectSuite({ kind: "suite", slug: suite.slug });
      }}
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
      onEditSuite={() => {
        const suiteId = view.selectedSuite?.id;
        if (suiteId) openDrawer(SUITE_EDITOR_DRAWER, { suiteId });
      }}
    />
  );
}
