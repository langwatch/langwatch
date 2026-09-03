/**
 * Every run entry of the Scenarios tab. Each one opens the run dialog; the
 * dialog owns the target choice, the note, the overrides, and the run itself.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { useCallback, useState } from "react";
import { toaster } from "@langwatch/design-system/toaster";
import { readScenarioTarget } from "../../use-scenario-target";
import type { RunDialogSubject, RunStartedInfo } from "../run/run-dialog";
import { useAgentTestingStore } from "../use-agent-testing-store";
import type { TestCase, TestSuiteEntry } from "../../../../model/agent-testing/cases/test-cases";
import { useOpenLiveRun } from "../../../../behavior/agent-testing/cases/use-open-live-run";

/**
 * The run dialog subject of a whole suite, with the scenarios it holds.
 *
 * A test suite carries no run option of its own, so the subject brings none.
 * The dialog then preselects from the newest run plan of the suite, which is
 * what `useRunHistorySeed` reads.
 */
function runSubjectForSuite({
  suite,
  cases,
}: {
  suite: TestSuiteEntry;
  cases: TestCase[];
}): RunDialogSubject {
  return {
    kind: "suite",
    suiteId: suite.id,
    name: suite.name,
    scenarioIds: cases
      .filter((testCase) => testCase.testSuiteId === suite.id)
      .map((testCase) => testCase.id),
    initialTarget: null,
    persistedTarget: null,
  };
}

/**
 * What happens the moment a run is queued. Shared by the table and the scenario
 * editor, so a run started from either one opens the same way.
 *
 * The run set is always the one of the plan the run joined, so the drawer and
 * the runs rail read the run back under that plan.
 */
export function useRunStartedHandler(): (info: RunStartedInfo) => void {
  const { openLiveRun } = useOpenLiveRun();
  const setPendingRun = useAgentTestingStore((state) => state.setPendingRun);

  return useCallback(
    ({ batchRunId, scenarioSetId, scenarioId, targetId }: RunStartedInfo) => {
      setPendingRun({ batchRunId, scenarioSetId });
      if (!scenarioId) {
        toaster.create({ title: "Run scheduled", type: "success" });
        return;
      }
      // A run of one scenario opens in the drawer right away and streams into
      // it, so the person watches the conversation without leaving the table.
      openLiveRun({ batchRunId, scenarioSetId, scenarioId, targetId });
    },
    [setPendingRun, openLiveRun],
  );
}

export type CaseRunActions = {
  /** The suite or scenario the run dialog is open on, if any. */
  runSubject: RunDialogSubject | null;
  closeRunDialog: () => void;
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
  const onRunStarted = useRunStartedHandler();

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
    onRunStarted,
    runCase,
    runSelectedSuite,
    runSuiteById,
  };
}
