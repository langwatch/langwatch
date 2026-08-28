/**
 * The suites rail of the Scenarios tab, wired to the tab model.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 */

import { SuiteRail } from "./SuiteRail";
import { useOpenSuiteLastRun } from "./useOpenSuiteLastRun";
import type { TestCasesTabModel } from "./useTestCasesTab";

export function TestCasesRail({ model }: { model: TestCasesTabModel }) {
  const { base, data, view, suiteMutations, suiteDialog, run } = model;
  const { periodPicker } = base;
  const isExternal = base.selection.kind === "external";
  const openSuiteLastRun = useOpenSuiteLastRun({
    suites: data.suites,
    lastRunBySuiteId: data.lastRunBySuiteId,
  });

  return (
    <SuiteRail
      selectedSuiteId={isExternal ? null : (view.selectedSuite?.id ?? null)}
      selectedExternalSetId={isExternal ? view.externalSetId : null}
      suites={data.suites}
      externalSets={data.externalSets}
      isLoading={data.isLoading}
      canManage={base.canManage}
      lastRunBySuiteId={data.lastRunBySuiteId}
      collapsed={base.isRailCollapsed}
      onToggleCollapsed={base.toggleRail}
      onSelect={base.selectSuite}
      onNewSuite={suiteDialog.openNew}
      onNewTestCase={(suiteId) => base.onNewTestCase(suiteId)}
      onRunSuite={run.runSuiteById}
      onRenameSuite={suiteDialog.openRename}
      onOpenLastRun={openSuiteLastRun}
      onArchiveSuite={suiteMutations.archiveSuite}
      isArchiving={suiteMutations.isArchiving}
      period={periodPicker.period}
      periodMode={periodPicker.mode}
      setPeriod={periodPicker.setPeriod}
      setRelativePeriod={periodPicker.setRelativePeriod}
    />
  );
}
