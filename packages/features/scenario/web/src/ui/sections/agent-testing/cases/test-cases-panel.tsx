/**
 * The cases panel of the Test cases tab, wired to the tab model.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { toExternalPlanSlug } from "../../../../behavior/agent-testing/results/run-plans";
import { CasesPanel } from "./cases-panel";
import { collectLabels } from "../../../../model/agent-testing/cases/test-cases";
import type { TestCasesTabModel } from "./use-test-cases-tab";

/** The name of the selected set, as the panel header reads it. */
function panelTitle({ base, view }: TestCasesTabModel): string {
  if (base.selection.kind === "all") return "All test cases";
  if (base.selection.kind === "suite") {
    return view.selectedSuite?.name ?? "Test suite";
  }
  return view.externalSetId;
}

export function TestCasesPanel({ model }: { model: TestCasesTabModel }) {
  const { base, data, view, caseMutations, suiteMutations, run, open } = model;
  const isExternal = base.selection.kind === "external";

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
      onEditSuite={() =>
        suiteMutations.setSuiteToRename(view.selectedSuite ?? null)
      }
    />
  );
}
