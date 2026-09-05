/**
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/features/agent-testing/live-single-scenario-run.feature
 * @see specs/suites/run-plan-identity-by-name.feature
 */

import { generate } from "@langwatch/ksuid";
import { getSuiteSetId } from "@langwatch/suite-contract";
import { useCallback, useRef } from "react";
import { useModelProvidersSettings } from "@langwatch/model-provider-web/hooks/useModelProvidersSettings";
import { writeScenarioTarget } from "../../use-scenario-target";
import { api } from "../../../../behavior/scenario-api";
import { KSUID_RESOURCES } from "@langwatch/workflow-contract";
import { useAgentTestingStore } from "../use-agent-testing-store";
import type { RunDialogSubmitInput, SuiteTargets } from "./use-run-dialog-submit";
import { flushSync } from "react-dom";
import type { TargetValue } from "../../../../model/scenario-target";
import { type RunScope, toSuiteScope } from "./run-configuration";
import type { RunStartedInfo } from "./run-dialog-types";

type RunAttempt = {
  /** What the person is queueing: subject, targets, note and parameters. */
  key: string;
  idempotencyKey: string;
  batchRunId: string;
};

/**
 * Holds the identity of the run the person is trying to queue. A failed attempt keeps
 * its identity, so a retry of the same request deduplicates on the server instead of
 * queueing a second batch. A queued run drops it, so the next run is a new batch.
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

/**
 * The one scenario a run covers, when a hand-picked scope names exactly one.
 */
function soleScenarioOf(scope: RunScope): string | null {
  if (scope.mode !== "scenarios" || scope.scenarioIds.length !== 1) return null;
  return scope.scenarioIds[0] ?? null;
}

/**
 * Remembers the agent the run went against.
 */
function rememberTarget({
  projectId,
  target,
  soleScenarioId,
  setLastRunTarget,
}: {
  projectId: string;
  target: TargetValue;
  soleScenarioId: string | null;
  setLastRunTarget: (target: TargetValue) => void;
}): void {
  if (!target) return;
  setLastRunTarget(target);
  if (soleScenarioId) {
    writeScenarioTarget({ projectId, scenarioId: soleScenarioId, target });
  }
}

/**
 * What the caller learns once a plan run is queued.
 */
function runStartedInfoOf({
  batchRunId,
  suiteId,
  soleScenarioId,
  target,
}: {
  batchRunId: string;
  suiteId: string;
  soleScenarioId: string | null;
  target: TargetValue;
}): RunStartedInfo {
  return {
    batchRunId,
    scenarioSetId: getSuiteSetId(suiteId),
    ...(soleScenarioId
      ? {
          scenarioId: soleScenarioId,
          ...(target ? { targetId: target.id } : {}),
        }
      : {}),
  };
}

/**
 * Queues a run under the name the dialog holds.
 */
function useQueuePlanRun(input: BatchRunInput) {
  const runPlan = api.suites.runPlan.useMutation();
  const { projectId, target, noteInput, runParameters, suiteTargets } = input;
  const { runName, scope, scopedScenarioIds } = input;
  const { repeatCount, simulatorModel, judgeModel } = input;
  const setLastRunTarget = useAgentTestingStore((state) => state.setLastRunTarget);

  const queuePlanRun = useCallback(
    async (attempt: RunAttempt): Promise<RunStartedInfo> => {
      const soleScenarioId = soleScenarioOf(scope);
      rememberTarget({ projectId, target, soleScenarioId, setLastRunTarget });
      const result = await runPlan.mutateAsync({
        projectId,
        name: runName.trim(),
        config: {
          scope: toSuiteScope(scope),
          // Only a hand-picked scope names its scenarios; every other one
          // resolves against the project at run time.
          ...(scope.mode === "scenarios" ? { scenarioIds: scopedScenarioIds } : {}),
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
      return runStartedInfoOf({
        batchRunId: result.batchRunId ?? attempt.batchRunId,
        suiteId: result.suiteId,
        soleScenarioId,
        target,
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
      setLastRunTarget,
      runPlan,
    ],
  );

  return { queuePlanRun, isPlanPending: runPlan.isPending };
}

/** Starts the run the dialog holds, and holds the attempt behind it. */
export function useBatchRun(input: BatchRunInput) {
  const { subject, projectId, onClose, onRunStarted, surfaceError } = input;
  const { setInlineError, setMissingProvider } = input;
  const { takeRunAttempt, clearRunAttempt } = useRunAttempt();
  const { queuePlanRun, isPlanPending } = useQueuePlanRun(input);
  const { hasEnabledProviders } = useModelProvidersSettings({
    projectId: projectId || undefined,
  });
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
    // Refused before an attempt is taken, so the person can set a provider up
    // and press Run again on the same identity.
    if (!hasEnabledProviders) {
      setMissingProvider(true);
      return;
    }
    const attempt = takeRunAttempt(attemptKey);
    try {
      const started = await queuePlanRun(attempt);
      clearRunAttempt();
      // The dialog goes first, and it is gone before the drawer opens. A
      // dialog that tears down over a drawer that has just opened is read as
      // an interaction outside that drawer, and the drawer closes itself on
      // the run it was opened for. flushSync is what makes "first" mean the
      // commit and not the queue.
      flushSync(() => onClose());
      onRunStarted(started);
    } catch (error) {
      surfaceError(error);
    }
  }, [
    subject,
    projectId,
    attemptKey,
    hasEnabledProviders,
    takeRunAttempt,
    clearRunAttempt,
    queuePlanRun,
    onClose,
    onRunStarted,
    setInlineError,
    setMissingProvider,
    surfaceError,
  ]);

  return { run, isBusy: isPlanPending };
}
