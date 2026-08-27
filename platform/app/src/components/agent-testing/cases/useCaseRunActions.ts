/**
 * Every run entry of the Scenarios tab. Each one opens the run dialog; the
 * dialog owns the target choice, the note, the overrides, and the run itself.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { useCallback, useState } from "react";
import { toaster } from "~/components/ui/toaster";
import { readScenarioTarget } from "~/hooks/useScenarioTarget";
import { getOnPlatformSetId } from "~/server/scenarios/internal-set-id";
import type { RunDialogSubject, RunStartedInfo } from "../run/RunDialog";
import type { AgentTestingSelection } from "../useAgentTestingRouting";
import { useAgentTestingStore } from "../useAgentTestingStore";
import type { TestCase, TestSuiteEntry } from "./test-cases";
import { useOpenLiveRun } from "./useOpenLiveRun";

/** The run dialog subject of a whole suite, with the cases it holds. */
function runSubjectForSuite({
  suite,
  cases,
}: {
  suite: TestSuiteEntry;
  cases: TestCase[];
}): RunDialogSubject {
  const persisted = suite.targets?.[0];
  return {
    kind: "suite",
    suiteId: suite.id,
    name: suite.name,
    scenarioIds: cases
      .filter((testCase) => testCase.folderId === suite.id)
      .map((testCase) => testCase.id),
    initialTarget: persisted
      ? { type: persisted.type, id: persisted.referenceId }
      : null,
    persistedTarget: persisted ?? null,
  };
}

/**
 * What happens the moment a run is queued. Shared by the table and the case
 * editor, so a run started from either one opens the same way.
 */
export function useRunStartedHandler({
  projectId,
  setRunningCaseId,
}: {
  projectId: string;
  /** Marks the row of a one-off run while it starts. */
  setRunningCaseId?: (scenarioId: string | null) => void;
}): (info: RunStartedInfo) => void {
  const { openLiveRun } = useOpenLiveRun();
  const setPendingRun = useAgentTestingStore((state) => state.setPendingRun);

  return useCallback(
    (info: RunStartedInfo) => {
      const scenarioSetId = info.scenarioSetId ?? getOnPlatformSetId(projectId);
      setPendingRun({ batchRunId: info.batchRunId, scenarioSetId });
      if (!info.scenarioId) {
        toaster.create({ title: "Run scheduled", type: "success" });
        return;
      }
      // A one-off run opens in the drawer right away and streams into it.
      setRunningCaseId?.(info.scenarioId);
      openLiveRun({
        batchRunId: info.batchRunId,
        scenarioSetId,
        scenarioId: info.scenarioId,
        targetId: info.targetId,
      });
    },
    [setPendingRun, setRunningCaseId, openLiveRun, projectId],
  );
}

export type CaseRunActions = {
  /** The suite or case the run dialog is open on, if any. */
  runSubject: RunDialogSubject | null;
  closeRunDialog: () => void;
  /** The case whose one-off run is starting, so its row can say so. */
  runningCaseId: string | null;
  clearRunningCase: () => void;
  onRunStarted: (info: RunStartedInfo) => void;
  runCase: (testCase: TestCase) => void;
  /** Runs the suite that is open. */
  runSelectedSuite: () => void;
  runSuiteById: (suiteId: string) => void;
};

export function useCaseRunActions({
  projectId,
  cases,
  suites,
  selectedSuite,
}: {
  projectId: string;
  cases: TestCase[];
  suites: TestSuiteEntry[];
  selectedSuite: TestSuiteEntry | null;
}): CaseRunActions {
  const [runSubject, setRunSubject] = useState<RunDialogSubject | null>(null);
  const [runningCaseId, setRunningCaseId] = useState<string | null>(null);
  const onRunStarted = useRunStartedHandler({ projectId, setRunningCaseId });

  const runCase = useCallback(
    (testCase: TestCase) => {
      setRunSubject({
        kind: "case",
        scenarioId: testCase.id,
        name: testCase.name,
        initialTarget: readScenarioTarget({
          projectId,
          scenarioId: testCase.id,
        }),
      });
    },
    [projectId],
  );

  const runSelectedSuite = useCallback(() => {
    if (!selectedSuite) return;
    setRunSubject(runSubjectForSuite({ suite: selectedSuite, cases }));
  }, [selectedSuite, cases]);

  const runSuiteById = useCallback(
    (suiteId: string) => {
      const suite = suites.find((entry) => entry.id === suiteId);
      if (suite) setRunSubject(runSubjectForSuite({ suite, cases }));
    },
    [suites, cases],
  );

  return {
    runSubject,
    closeRunDialog: () => setRunSubject(null),
    runningCaseId,
    clearRunningCase: () => setRunningCaseId(null),
    onRunStarted,
    runCase,
    runSelectedSuite,
    runSuiteById,
  };
}
