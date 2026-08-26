/**
 * Every way the Test cases tab opens one case: the editor drawer, the version
 * history, and the run it last had.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see dev/docs/best_practices/drawers.md
 */

import { useCallback } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import { CASE_EDITOR_DRAWER } from "./AgentTestingCaseEditorDrawer";
import type { CaseLastResult } from "./CasesTable";
import type { TestCase } from "./test-cases";
import { useOpenLiveRun } from "./useOpenLiveRun";

export type CaseOpenActions = {
  openEditor: (testCase: TestCase) => void;
  openHistory: (testCase: TestCase) => void;
  openLastRun: (testCase: TestCase) => void;
  /** A row opens its last run when it has one, and the editor otherwise. */
  onRowClick: (testCase: TestCase) => void;
};

export function useCaseOpenActions(
  lastResults: Map<string, CaseLastResult>,
): CaseOpenActions {
  const { openLiveRun } = useOpenLiveRun();
  const { openDrawer } = useDrawer();

  const openEditor = useCallback(
    (testCase: TestCase) =>
      openDrawer(CASE_EDITOR_DRAWER, { scenarioId: testCase.id }),
    [openDrawer],
  );

  // The history reads inside the case drawer, beside the version it is the
  // history of, so History opens the case with its versions already open.
  const openHistory = useCallback(
    (testCase: TestCase) =>
      openDrawer(CASE_EDITOR_DRAWER, {
        scenarioId: testCase.id,
        showHistory: "true",
      }),
    [openDrawer],
  );

  const openLastRun = useCallback(
    (testCase: TestCase) => {
      const lastResult = lastResults.get(testCase.id);
      if (!lastResult) return;
      openLiveRun({
        batchRunId: lastResult.batchRunId,
        scenarioSetId: lastResult.scenarioSetId,
        scenarioId: testCase.id,
      });
    },
    [lastResults, openLiveRun],
  );

  const onRowClick = useCallback(
    (testCase: TestCase) => {
      if (lastResults.has(testCase.id)) {
        openLastRun(testCase);
        return;
      }
      openEditor(testCase);
    },
    [lastResults, openLastRun, openEditor],
  );

  return { openEditor, openHistory, openLastRun, onRowClick };
}
