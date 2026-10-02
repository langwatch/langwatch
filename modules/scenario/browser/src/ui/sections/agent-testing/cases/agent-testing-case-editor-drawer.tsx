/**
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/run-plan-editor.feature
 * @see dev/docs/best_practices/drawers.md
 */

import { getFlowCallbacks, useDrawer, useDrawerParams } from "@langwatch/browser-host/drawer";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { toaster } from "@langwatch/design-system/toaster";
import {
  parseEvaluatorAttachments,
  parseSuiteFieldDefinitions,
} from "@langwatch/scenario-contract";
import { useCallback, useMemo } from "react";

import { type Scenario } from "../../../../behavior/scenario-api.ts";
import { useTestSuites } from "../../../../behavior/suites/use-test-suites.ts";
// The key lives in a component-free module so a static importer never pulls
// this drawer's React and Chakra dependencies into its own chunk. The drawer
// re-exports the key so existing importers stay unaffected.
import { CASE_EDITOR_DRAWER } from "../../../../model/agent-testing/cases/drawer-keys.ts";
import type { TestSuiteEntry } from "../../../../model/agent-testing/cases/test-cases.ts";
import { CaseModal } from "./case-modal.tsx";
import { useCaseEditor } from "./use-case-editor.ts";

export { CASE_EDITOR_DRAWER };

/**
 * The props scenario's case editor accepts at open time. The three URL-serializable fields
 * survive a reload; the flow callback is registered separately via `setFlowCallbacks`.
 */
export type UiAgentTestingCaseEditorDrawerProps = {
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
  const { data: testSuites } = useTestSuites({ projectId });

  return useMemo<TestSuiteEntry[]>(
    () =>
      (testSuites ?? []).map((testSuite) => ({
        id: testSuite.id,
        name: testSuite.name,
        slug: testSuite.slug,
        caseCount: 0,
        fields: parseSuiteFieldDefinitions(testSuite.fields),
        evaluators: parseEvaluatorAttachments(testSuite.evaluators),
      })),
    [testSuites],
  );
}

export function AgentTestingCaseEditorDrawer(_props: UiAgentTestingCaseEditorDrawerProps) {
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
    suites,
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
