/**
 * How a run starts.
 *
 * A one-off case runs through the scenario runner, which watches it start. The
 * other three entry points all queue the same way: a name and a configuration
 * go to the server, which resolves the name onto a run plan.
 *
 * A refusal the server can name reads inside the dialog. Only failures with
 * nothing structured to say fall back to a toast.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/suites/folder-run-plan-reuse.feature
 */

import { generate } from "@langwatch/ksuid";
import { useCallback, useRef } from "react";
import { useModelProvidersSettings } from "~/hooks/useModelProvidersSettings";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRunScenario } from "~/hooks/useRunScenario";
import { writeScenarioTarget } from "~/hooks/useScenarioTarget";
import { getOnPlatformSetId } from "~/server/scenarios/internal-set-id";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
import { api } from "~/utils/api";
import { KSUID_RESOURCES } from "~/utils/constants";
import { useAgentTestingStore } from "../useAgentTestingStore";
import { toSuiteScope } from "./run-configuration";
import type { RunDialogSubmitInput, SuiteTargets } from "./useRunDialogSubmit";

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

/** A one-off run of a single scenario, started from the dialog. */
function useCaseRun(input: BatchRunInput) {
  const { target, projectId, noteInput, runParameters } = input;
  const { onRunStarted, onClose, setMissingProvider } = input;
  const setLastRunTarget = useAgentTestingStore(
    (state) => state.setLastRunTarget,
  );
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

/**
 * Queues a run under the name the dialog holds.
 *
 * This is the one path every entry point but the one-off case takes: the
 * server resolves the name, joins the plan of that name or creates one, writes
 * the configuration onto it and runs it. Nothing is read off a test suite row,
 * which is what keeps a suite a pure grouping.
 */
function useQueuePlanRun(input: BatchRunInput) {
  const runPlan = api.suites.runPlan.useMutation();
  const { projectId, target, noteInput, runParameters, suiteTargets } = input;
  const { onRunStarted, runName, scope, scopedScenarioIds } = input;
  const { repeatCount, simulatorModel, judgeModel } = input;
  const setLastRunTarget = useAgentTestingStore(
    (state) => state.setLastRunTarget,
  );

  const queuePlanRun = useCallback(
    async (attempt: RunAttempt) => {
      if (target) setLastRunTarget(target);
      const result = await runPlan.mutateAsync({
        projectId,
        name: runName.trim(),
        config: {
          scope: toSuiteScope(scope),
          // Only a hand-picked scope names its scenarios; every other one
          // resolves against the project at run time.
          ...(scope.mode === "cases" ? { scenarioIds: scopedScenarioIds } : {}),
          targets: suiteTargets ?? [],
          repeatCount,
          simulatorModel,
          judgeModel,
        },
        idempotencyKey: attempt.idempotencyKey,
        batchRunId: attempt.batchRunId,
        note: noteInput,
        parameters: runParameters,
      });
      onRunStarted({
        batchRunId: result.batchRunId ?? attempt.batchRunId,
        scenarioSetId: getSuiteSetId(result.suiteId),
      });
    },
    [
      projectId,
      target,
      runName,
      scope,
      scopedScenarioIds,
      suiteTargets,
      repeatCount,
      simulatorModel,
      judgeModel,
      noteInput,
      runParameters,
      onRunStarted,
      setLastRunTarget,
      runPlan,
    ],
  );

  return { queuePlanRun, isPlanPending: runPlan.isPending };
}

/** Starts the run the subject asks for, and holds the attempt behind it. */
export function useBatchRun(input: BatchRunInput) {
  const { subject, projectId, onClose, surfaceError } = input;
  const { setInlineError, setMissingProvider } = input;
  const { takeRunAttempt, clearRunAttempt } = useRunAttempt();
  const { runCase, isCaseRunning } = useCaseRun(input);
  const { queuePlanRun, isPlanPending } = useQueuePlanRun(input);
  // One identity per attempt, not per click. The dialog stays open when the
  // call fails, and a request that timed out may already be accepted, so a
  // retry has to carry the same key or the server queues a second batch.
  // Editing the note, the parameters or the targets starts a new attempt.
  const attemptKey = JSON.stringify([
    subject,
    input.runName,
    input.scope,
    input.suiteTargets,
    input.repeatCount,
    input.simulatorModel,
    input.judgeModel,
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
      await queuePlanRun(attempt);
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
    queuePlanRun,
    onClose,
    setInlineError,
    setMissingProvider,
    surfaceError,
  ]);

  const isPending = isPlanPending;

  return {
    run,
    isPending,
    isRunning: isPending || isCaseRunning,
  };
}
