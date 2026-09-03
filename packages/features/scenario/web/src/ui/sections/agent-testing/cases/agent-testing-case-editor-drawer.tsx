/**
 * URL-routed wrapper of the Agent Testing scenario editor drawer.
 *
 * The drawer reads its target from the address bar, so a shared link, a
 * browser back and a Save & Run flow all resolve to the same open drawer.
 * The Save & Run callback is registered by the page through flow callbacks
 * so the page can open the run drawer after the editor closes.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/run-plan-editor.feature
 * @see dev/docs/best_practices/drawers.md
 */

import { useCallback, useMemo } from "react";
import { toaster } from "@langwatch/design-system/toaster";
import type { Scenario } from "../../../../model/prisma-types";
import { getFlowCallbacks, useDrawer, useDrawerParams } from "@langwatch/ui-drawer";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project";
import { api } from "../../../../behavior/scenario-api";
import { CaseModal } from "./case-modal";
// The key lives in a component-free module so a static importer never pulls
// this drawer's React and Chakra dependencies into its own chunk. The drawer
// re-exports the key so existing importers stay unaffected.
import { CASE_EDITOR_DRAWER } from "./drawer-keys";
import type { TestSuiteEntry } from "../../../../model/agent-testing/cases/test-cases";
import { useCaseEditor } from "./use-case-editor";

export { CASE_EDITOR_DRAWER };

/**
 * The props the drawer accepts at open time. The three URL-serializable fields
 * survive a reload; the flow callback is registered separately via
 * `setFlowCallbacks`.
 */
export type AgentTestingCaseEditorDrawerProps = {
  /** The scenario being edited, or absent for a new one. */
  scenarioId?: string;
  /** The suite a new scenario starts in. */
  testSuiteId?: string;
  /** "true" opens the scenario with its version history strip open. */
  showHistory?: string;
  /** Called when a scenario is saved. `shouldRunAfterSave` is true for Save & Run. */
  onSaved?: (saved: Scenario, options: { shouldRunAfterSave: boolean }) => void;
};

function useEditorSuites(projectId: string): TestSuiteEntry[] {
  const { data: testSuites } = api.suites.testSuites.getAll.useQuery(
    { projectId },
    { enabled: !!projectId },
  );

  return useMemo<TestSuiteEntry[]>(
    () =>
      (testSuites ?? []).map((testSuite) => ({
        id: testSuite.id,
        name: testSuite.name,
        slug: testSuite.slug,
        caseCount: 0,
      })),
    [testSuites],
  );
}

export function AgentTestingCaseEditorDrawer(_props: AgentTestingCaseEditorDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const { closeDrawer, drawerOpen } = useDrawer();
  const params = useDrawerParams();

  const isOpen = drawerOpen(CASE_EDITOR_DRAWER);
  const scenarioId = params.scenarioId ?? null;
  const testSuiteId = params.testSuiteId ?? null;
  const showHistory = params.showHistory === "true";

  const suites = useEditorSuites(projectId);

  const callbacks = getFlowCallbacks(CASE_EDITOR_DRAWER);

  const onSaved = useCallback(
    (saved: Scenario, options: { shouldRunAfterSave: boolean }) => {
      toaster.create({
        title: scenarioId ? "Scenario updated" : "Scenario created",
        type: "success",
      });
      closeDrawer();
      callbacks?.onSaved?.(saved, options);
    },
    [callbacks, closeDrawer, scenarioId],
  );

  const editor = useCaseEditor({
    open: isOpen,
    projectId,
    scenarioId,
    testSuiteId,
    onSaved,
  });

  return (
    <CaseModal
      open={isOpen}
      scenarioId={scenarioId}
      suites={suites}
      editor={editor}
      onClose={closeDrawer}
      openHistoryOnOpen={showHistory}
    />
  );
}

export default AgentTestingCaseEditorDrawer;
