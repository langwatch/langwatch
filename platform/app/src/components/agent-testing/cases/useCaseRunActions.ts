/**
 * Every run entry of the Test cases tab. Each one opens the run dialog; the
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
function runSubjectForSuite(
  suite: TestSuiteEntry,
  cases: TestCase[],
): RunDialogSubject {
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
  };
}

/** What happens the moment a run is queued. */
function useRunStartedHandler({
  projectId,
  setRunningCaseId,
}: {
  projectId: string;
  setRunningCaseId: (scenarioId: string | null) => void;
}): (info: RunStartedInfo) => void {
  const { openLiveRun } = useOpenLiveRun();
  const setPendingBatchRunId = useAgentTestingStore(
    (state) => state.setPendingBatchRunId,
  );

  return useCallback(
    (info: RunStartedInfo) => {
      setPendingBatchRunId(info.batchRunId);
      if (!info.scenarioId) {
        toaster.create({ title: "Run scheduled", type: "success" });
        return;
      }
      // A one-off run opens in the drawer right away and streams into it.
      setRunningCaseId(info.scenarioId);
      openLiveRun({
        batchRunId: info.batchRunId,
        scenarioSetId: info.scenarioSetId ?? getOnPlatformSetId(projectId),
        scenarioId: info.scenarioId,
        targetId: info.targetId,
      });
    },
    [setPendingBatchRunId, setRunningCaseId, openLiveRun, projectId],
  );
}

export type CaseRunActions = {
  /** The set or case the run dialog is open on, if any. */
  runSubject: RunDialogSubject | null;
  closeRunDialog: () => void;
  /** The case whose one-off run is starting, so its row can say so. */
  runningCaseId: string | null;
  clearRunningCase: () => void;
  onRunStarted: (info: RunStartedInfo) => void;
  runCase: (testCase: TestCase) => void;
  runSelectedSet: () => void;
  runSuiteById: (suiteId: string) => void;
};

export function useCaseRunActions({
  projectId,
  cases,
  suites,
  selection,
  selectedSuite,
}: {
  projectId: string;
  cases: TestCase[];
  suites: TestSuiteEntry[];
  selection: AgentTestingSelection;
  selectedSuite: TestSuiteEntry | null;
}): CaseRunActions {
  const [runSubject, setRunSubject] = useState<RunDialogSubject | null>(null);
  const [runningCaseId, setRunningCaseId] = useState<string | null>(null);
  const lastRunTarget = useAgentTestingStore((state) => state.lastRunTarget);
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

  const runSelectedSet = useCallback(() => {
    if (selection.kind === "suite" && selectedSuite) {
      setRunSubject(runSubjectForSuite(selectedSuite, cases));
      return;
    }
    setRunSubject({ kind: "all", initialTarget: lastRunTarget });
  }, [selection, selectedSuite, cases, lastRunTarget]);

  const runSuiteById = useCallback(
    (suiteId: string) => {
      const suite = suites.find((entry) => entry.id === suiteId);
      if (suite) setRunSubject(runSubjectForSuite(suite, cases));
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
    runSelectedSet,
    runSuiteById,
  };
}
