/**
 * Every way the Test cases tab opens one case: the editor, the version
 * history, and the run it last had.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { useCallback } from "react";
import { useAgentTestingStore } from "../use-agent-testing-store";
import type { CaseLastResult } from "./cases-table";
import type { TestCase } from "./test-cases";
import { useOpenLiveRun } from "./use-open-live-run";

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
  const openCaseEditor = useAgentTestingStore((state) => state.openCaseEditor);

  const openEditor = useCallback(
    (testCase: TestCase) => openCaseEditor({ scenarioId: testCase.id }),
    [openCaseEditor],
  );

  // The history reads inside the case dialog, beside the version it is the
  // history of, so History opens the case with its versions already open.
  const openHistory = useCallback(
    (testCase: TestCase) =>
      openCaseEditor({ scenarioId: testCase.id, showHistory: true }),
    [openCaseEditor],
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
