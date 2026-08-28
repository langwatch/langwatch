/**
 * How a run starts.
 *
 * Every entry point queues the same way: a name and a configuration go to the
 * server, which resolves the name onto a run plan. A run of one scenario is an
 * ordinary run plan too, named after that scenario and the agent it goes
 * against, so running the same pair again stacks a second run on the same plan
 * and the plan grows a trend.
 *
 * A refusal the server can name reads inside the dialog. Only failures with
 * nothing structured to say fall back to a toast.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/features/agent-testing/live-single-scenario-run.feature
 * @see specs/suites/run-plan-identity-by-name.feature
 */

import { generate } from "@langwatch/ksuid";
import { useCallback, useRef } from "react";
import type { TargetValue } from "~/components/scenarios/TargetSelector";
import { useModelProvidersSettings } from "~/hooks/useModelProvidersSettings";
import { writeScenarioTarget } from "~/hooks/useScenarioTarget";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
import { api } from "~/utils/api";
import { KSUID_RESOURCES } from "~/utils/constants";
import { useAgentTestingStore } from "../useAgentTestingStore";
import { type RunScope, toSuiteScope } from "./run-configuration";
import type { RunStartedInfo } from "./run-dialog-types";
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

/**
 * The one scenario a run covers, when a hand-picked scope names exactly one.
 *
 * A run of one scenario opens straight into the run drawer, and the row it was
 * started from remembers the agent it went against. Everything else about it
 * is an ordinary plan run.
 */
function soleScenarioOf(scope: RunScope): string | null {
  if (scope.mode !== "scenarios" || scope.scenarioIds.length !== 1) return null;
  return scope.scenarioIds[0] ?? null;
}

/**
 * Remembers the agent the run went against.
 *
 * The dialog opens on the last agent of the whole page, and a scenario row
 * opens on the last agent of that scenario, so a run of one scenario writes
 * both.
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
 *
 * The run set is the plan's own, so the drawer and the runs rail read the run
 * back under that plan. A run of one scenario also names it and the agent, so
 * the drawer can open on the run before the run has an id.
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
 *
 * This is the one path every entry point takes: the server resolves the name,
 * joins the plan of that name or creates one, writes the configuration onto it
 * and runs it. Nothing is read off a test suite row, which is what keeps a
 * suite a pure grouping.
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
      const soleScenarioId = soleScenarioOf(scope);
      rememberTarget({ projectId, target, soleScenarioId, setLastRunTarget });
      const result = await runPlan.mutateAsync({
        projectId,
        name: runName.trim(),
        config: {
          scope: toSuiteScope(scope),
          // Only a hand-picked scope names its scenarios; every other one
          // resolves against the project at run time.
          ...(scope.mode === "scenarios"
            ? { scenarioIds: scopedScenarioIds }
            : {}),
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
      onRunStarted(
        runStartedInfoOf({
          batchRunId: result.batchRunId ?? attempt.batchRunId,
          suiteId: result.suiteId,
          soleScenarioId,
          target,
        }),
      );
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

/** Starts the run the dialog holds, and holds the attempt behind it. */
export function useBatchRun(input: BatchRunInput) {
  const { subject, projectId, onClose, surfaceError } = input;
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
    hasEnabledProviders,
    takeRunAttempt,
    clearRunAttempt,
    queuePlanRun,
    onClose,
    setInlineError,
    setMissingProvider,
    surfaceError,
  ]);

  return { run, isBusy: isPlanPending };
}
