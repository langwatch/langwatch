/**
 * The four ways a run starts: a one-off case, a stored test suite, every case
 * at once, and the choice between them.
 *
 * A refusal the server can name reads inside the dialog. Only failures with
 * nothing structured to say fall back to a toast.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/suites/folder-run-plan-reuse.feature
 */

import { generate } from "@langwatch/ksuid";
import { getOnPlatformSetId } from "@langwatch/scenario-contract";
import { getSuiteSetId } from "@langwatch/suite-contract";
import { useCallback, useRef } from "react";
import { useModelProvidersSettings } from "@langwatch/model-provider-web/hooks/useModelProvidersSettings";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project";
import { useRunScenario } from "../../../hooks/use-run-scenario";
import { writeScenarioTarget } from "../../../hooks/use-scenario-target";
import { api } from "../../../behavior/scenario-api";
import { KSUID_RESOURCES } from "@langwatch/workflow-web/utils/constants";
import { useAgentTestingStore } from "../use-agent-testing-store";
import type { RunDialogSubmitInput, SuiteTargets } from "./use-run-dialog-submit";

type RunAttempt = {
  /** What the person is queueing: subject, targets, note and parameters. */
  key: string;
  idempotencyKey: string;
  batchRunId: string;
};

/**
 * Holds the identity of the run the person is trying to queue. A failed
 * attempt keeps its identity, so a retry of the same request deduplicates on
 * the server instead of queueing a second batch. A queued run drops it, so
 * the next run is a new batch.
 */
function useRunAttempt() {
  const attemptRef = useRef<RunAttempt | null>(null);

  const takeRunAttempt = useCallback((key: string): RunAttempt => {
    if (attemptRef.current?.key !== key) {
      attemptRef.current = {
        key,
        idempotencyKey: crypto.randomUUID(),
        batchRunId: generate(KSUID_RESOURCES.SCENARIO_BATCH).toString(),
      };
    }
    return attemptRef.current;
  }, []);

  const clearRunAttempt = useCallback(() => {
    attemptRef.current = null;
  }, []);

  return { takeRunAttempt, clearRunAttempt };
}

export type BatchRunInput = RunDialogSubmitInput & {
  projectId: string;
  suiteTargets: SuiteTargets;
  noteInput: string | undefined;
  persistTargetChoice: () => Promise<void>;
  surfaceError: (error: unknown) => void;
};

/** The start-up poll of a one-off run, which settles well or not. */
function useCaseRunScenario({
  subject,
  onCaseRunSettled,
}: Pick<BatchRunInput, "subject" | "onCaseRunSettled">) {
  const { project } = useOrganizationTeamProject();
  const scenarioId = subject?.kind === "case" ? subject.scenarioId : null;

  const settleCaseRun = useCallback(() => {
    if (scenarioId) onCaseRunSettled?.(scenarioId);
  }, [scenarioId, onCaseRunSettled]);

  return useRunScenario({
    projectId: project?.id,
    projectSlug: project?.slug,
    onQueued: () => undefined,
    onRunComplete: settleCaseRun,
    onRunFailed: settleCaseRun,
  });
}

/** A one-off run of a single test case, started from the dialog. */
function useCaseRun(input: BatchRunInput) {
  const { target, projectId, noteInput, runParameters } = input;
  const { onRunStarted, onClose, setMissingProvider } = input;
  const setLastRunTarget = useAgentTestingStore((state) => state.setLastRunTarget);
  const { hasEnabledProviders } = useModelProvidersSettings({
    projectId: projectId || undefined,
  });
  const { runScenario, isRunning: isCaseRunning } = useCaseRunScenario(input);

  const runCase = useCallback(
    (scenarioId: string) => {
      if (!target) return;
      if (!hasEnabledProviders) {
        setMissingProvider(true);
        return;
      }
      writeScenarioTarget({ projectId, scenarioId, target });
      setLastRunTarget(target);
      const batchRunId = generate(KSUID_RESOURCES.SCENARIO_BATCH).toString();
      void runScenario({
        scenarioId,
        target,
        batchRunId,
        note: noteInput,
        parameters: runParameters,
      });
      onRunStarted({
        batchRunId,
        scenarioSetId: getOnPlatformSetId(projectId),
        scenarioId,
        targetId: target.id,
      });
      onClose();
    },
    [
      target,
      hasEnabledProviders,
      projectId,
      runScenario,
      noteInput,
      runParameters,
      onRunStarted,
      onClose,
      setLastRunTarget,
      setMissingProvider,
    ],
  );

  return { runCase, isCaseRunning };
}

/** Queues the run of a saved test suite, after its target is written down. */
function useQueueSuiteRun(input: BatchRunInput) {
  const runSuite = api.suites.run.useMutation();
  const { projectId, noteInput, runParameters } = input;
  const { onRunStarted, persistTargetChoice } = input;

  const queueSuiteRun = useCallback(
    async (suiteId: string, attempt: RunAttempt) => {
      await persistTargetChoice();
      const result = await runSuite.mutateAsync({
        projectId,
        id: suiteId,
        idempotencyKey: attempt.idempotencyKey,
        batchRunId: attempt.batchRunId,
        note: noteInput,
        parameters: runParameters,
      });
      onRunStarted({
        batchRunId: result.batchRunId ?? attempt.batchRunId,
        scenarioSetId: getSuiteSetId(suiteId),
      });
    },
    [projectId, noteInput, runParameters, onRunStarted, persistTargetChoice, runSuite],
  );

  return { queueSuiteRun, isSuitePending: runSuite.isPending };
}

/** Queues a run of every test case, targets and all, in one request. */
function useQueueAllRun(input: BatchRunInput) {
  const runAll = api.suites.runAll.useMutation();
  const { projectId, target, suiteTargets, noteInput, runParameters } = input;
  const { onRunStarted } = input;
  const setLastRunTarget = useAgentTestingStore((state) => state.setLastRunTarget);

  const queueAllRun = useCallback(
    async (attempt: RunAttempt) => {
      if (target) setLastRunTarget(target);
      const result = await runAll.mutateAsync({
        projectId,
        idempotencyKey: attempt.idempotencyKey,
        batchRunId: attempt.batchRunId,
        targets: suiteTargets,
        note: noteInput,
        parameters: runParameters,
      });
      onRunStarted({ batchRunId: result.batchRunId ?? attempt.batchRunId });
    },
    [
      projectId,
      target,
      suiteTargets,
      noteInput,
      runParameters,
      onRunStarted,
      setLastRunTarget,
      runAll,
    ],
  );

  return { queueAllRun, isAllPending: runAll.isPending };
}

/** Starts the run the subject asks for, and holds the attempt behind it. */
export function useBatchRun(input: BatchRunInput) {
  const { subject, projectId, onClose, surfaceError } = input;
  const { setInlineError, setMissingProvider } = input;
  const { takeRunAttempt, clearRunAttempt } = useRunAttempt();
  const { runCase, isCaseRunning } = useCaseRun(input);
  const { queueSuiteRun, isSuitePending } = useQueueSuiteRun(input);
  const { queueAllRun, isAllPending } = useQueueAllRun(input);
  // One identity per attempt, not per click. The dialog stays open when the
  // call fails, and a request that timed out may already be accepted, so a
  // retry has to carry the same key or the server queues a second batch.
  // Editing the note, the parameters or the targets starts a new attempt.
  const attemptKey = JSON.stringify([
    subject,
    input.suiteTargets,
    input.noteInput,
    input.runParameters,
  ]);

  const run = useCallback(async () => {
    if (!subject || !projectId) return;
    setInlineError(null);
    setMissingProvider(false);
    if (subject.kind === "case") {
      runCase(subject.scenarioId);
      return;
    }
    const attempt = takeRunAttempt(attemptKey);
    try {
      if (subject.kind === "suite") {
        await queueSuiteRun(subject.suiteId, attempt);
      } else {
        await queueAllRun(attempt);
      }
      clearRunAttempt();
      onClose();
    } catch (error) {
      surfaceError(error);
    }
  }, [
    subject,
    projectId,
    attemptKey,
    runCase,
    takeRunAttempt,
    clearRunAttempt,
    queueSuiteRun,
    queueAllRun,
    onClose,
    setInlineError,
    setMissingProvider,
    surfaceError,
  ]);

  return {
    run,
    isPending: isSuitePending || isAllPending,
    isRunning: isSuitePending || isAllPending || isCaseRunning,
  };
}
