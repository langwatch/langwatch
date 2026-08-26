/**
 * The suites rail of the Test cases tab, wired to the tab model.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 */

import { useDrawer } from "~/hooks/useDrawer";
import { SUITE_EDITOR_DRAWER } from "./AgentTestingSuiteEditorDrawer";
import { SuiteRail } from "./SuiteRail";
import type { TestCasesTabModel } from "./useTestCasesTab";

export function TestCasesRail({ model }: { model: TestCasesTabModel }) {
  const { base, data, suiteMutations, run } = model;
  const { periodPicker } = base;
  const { openDrawer } = useDrawer();

  return (
    <SuiteRail
      selection={base.selection}
      suites={data.suites}
      externalSets={data.externalSets}
      isLoading={data.isLoading}
      canManage={base.canManage}
      suiteIdsWithRuns={data.suiteIdsWithRuns}
      collapsed={base.isRailCollapsed}
      onToggleCollapsed={base.toggleRail}
      onSelect={base.selectSuite}
      onCreateSuite={suiteMutations.createSuite}
      onNewTestCase={(suiteId) => base.onNewTestCase(suiteId)}
      onRunSuite={run.runSuiteById}
      onEditSuite={(suiteId) => openDrawer(SUITE_EDITOR_DRAWER, { suiteId })}
      onOpenLastRun={(suite) => base.selectPlan(suite.slug)}
      onArchiveSuite={suiteMutations.archiveSuite}
      isArchiving={suiteMutations.isArchiving}
      period={periodPicker.period}
      periodMode={periodPicker.mode}
      setPeriod={periodPicker.setPeriod}
      setRelativePeriod={periodPicker.setRelativePeriod}
    />
  );
}
