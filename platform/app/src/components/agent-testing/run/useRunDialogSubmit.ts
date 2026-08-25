/**
 * The writes of the run dialog: persist the target, then start the run
 * through the path the subject uses.
 *
 * A refusal the server can name reads inside the dialog and the dialog stays
 * open. Only failures with nothing structured to say fall back to a toast.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/suites/folder-run-plan-reuse.feature
 */

import { generate } from "@langwatch/ksuid";
import { useCallback, useRef } from "react";
import type { TargetValue } from "~/components/scenarios/TargetSelector";
import { readHandledError, showErrorToast } from "~/features/errors";
import { useModelProvidersSettings } from "~/hooks/useModelProvidersSettings";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRunScenario } from "~/hooks/useRunScenario";
import { writeScenarioTarget } from "~/hooks/useScenarioTarget";
import { useAllPromptsForProject } from "~/prompts/hooks/useAllPromptsForProject";
import { getOnPlatformSetId } from "~/server/scenarios/internal-set-id";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
import { api } from "~/utils/api";
import { KSUID_RESOURCES } from "~/utils/constants";
import { useAgentTestingStore } from "../useAgentTestingStore";
import type { toLineRunParameters } from "./parameter-line";
import type { RunDialogSubject, RunStartedInfo } from "./run-dialog-types";

/** The overrides a queued run carries, when the dialog collected any. */
type RunParameters = ReturnType<typeof toLineRunParameters>;

/** The targets a suite run is written against. */
function toSuiteTargets(target: TargetValue) {
  if (!target) return undefined;
  return [{ type: target.type, referenceId: target.id }];
}

type SuiteTargets = ReturnType<typeof toSuiteTargets>;

/** The note as the server takes it: trimmed, and absent when empty. */
function toNoteInput(note: string): string | undefined {
  const trimmed = note.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export type RunDialogSubmitInput = {
  subject: RunDialogSubject | null;
  target: TargetValue;
  note: string;
  runParameters: RunParameters;
  onRunStarted: (info: RunStartedInfo) => void;
  onCaseRunSettled?: (scenarioId: string) => void;
  onClose: () => void;
  setInlineError: (error: unknown) => void;
  setMissingProvider: (missing: boolean) => void;
};

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

/** Whether the project has anything at all to run a test case against. */
function useHasAnyTarget(subject: RunDialogSubject | null) {
  const { project } = useOrganizationTeamProject();
  const { data: agents } = api.agents.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project && !!subject },
  );
  const { data: prompts } = useAllPromptsForProject();
  const hasAgent = (agents ?? []).length > 0;
  const hasPublishedPrompt = (prompts ?? []).some(
    (prompt) => prompt.version > 0,
  );
  return hasAgent || hasPublishedPrompt;
}

/** Shows a coded refusal inside the dialog; anything else becomes a toast. */
function useSurfaceRunError(setInlineError: (error: unknown) => void) {
  return useCallback(
    (error: unknown) => {
      if (readHandledError(error)) {
        setInlineError(error);
        return;
      }
      showErrorToast({ error, fallbackTitle: "Couldn't start the run" });
    },
    [setInlineError],
  );
}

/** Writes down the target the person confirmed, by the path the subject uses. */
function usePersistTargetChoice({
  subject,
  target,
  projectId,
  suiteTargets,
}: {
  subject: RunDialogSubject | null;
  target: TargetValue;
  projectId: string;
  suiteTargets: SuiteTargets;
}) {
  const utils = api.useUtils();
  const updateSuite = api.suites.update.useMutation();
  const setLastRunTarget = useAgentTestingStore(
    (state) => state.setLastRunTarget,
  );

  const persistTargetChoice = useCallback(async () => {
    if (!subject || !target) return;
    setLastRunTarget(target);
    if (subject.kind === "case") {
      writeScenarioTarget({
        projectId,
        scenarioId: subject.scenarioId,
        target,
      });
      return;
    }
    if (subject.kind === "suite" && suiteTargets) {
      await updateSuite.mutateAsync({
        projectId,
        id: subject.suiteId,
        targets: suiteTargets,
      });
      // The rail's folder list carries the persisted targets; the next open
      // of this dialog preselects from it.
      void utils.suites.folders.getAll.invalidate({ projectId });
    }
    // Run all persists its targets through the run itself: the managed suite
    // may not exist before the first run.
  }, [
    subject,
    target,
    projectId,
    suiteTargets,
    updateSuite,
    utils,
    setLastRunTarget,
  ]);

  return { persistTargetChoice, isSaving: updateSuite.isPending };
}

/** Save writes the target down and closes; it never starts a run. */
function useSaveTargetChoice({
  persistTargetChoice,
  onClose,
  setInlineError,
  surfaceError,
}: {
  persistTargetChoice: () => Promise<void>;
  onClose: () => void;
  setInlineError: (error: unknown) => void;
  surfaceError: (error: unknown) => void;
}) {
  return useCallback(async () => {
    setInlineError(null);
    try {
      await persistTargetChoice();
      onClose();
    } catch (error) {
      surfaceError(error);
    }
  }, [persistTargetChoice, onClose, setInlineError, surfaceError]);
}

type BatchRunInput = RunDialogSubmitInput & {
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
    [
      projectId,
      noteInput,
      runParameters,
      onRunStarted,
      persistTargetChoice,
      runSuite,
    ],
  );

  return { queueSuiteRun, isSuitePending: runSuite.isPending };
}

/** Queues a run of every test case, targets and all, in one request. */
function useQueueAllRun(input: BatchRunInput) {
  const runAll = api.suites.runAll.useMutation();
  const { projectId, target, suiteTargets, noteInput, runParameters } = input;
  const { onRunStarted } = input;
  const setLastRunTarget = useAgentTestingStore(
    (state) => state.setLastRunTarget,
  );

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
function useBatchRun(input: BatchRunInput) {
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

export function useRunDialogSubmit(input: RunDialogSubmitInput) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const suiteTargets = toSuiteTargets(input.target);
  const noteInput = toNoteInput(input.note);
  const hasAnyTarget = useHasAnyTarget(input.subject);
  const surfaceError = useSurfaceRunError(input.setInlineError);

  const { persistTargetChoice, isSaving } = usePersistTargetChoice({
    subject: input.subject,
    target: input.target,
    projectId,
    suiteTargets,
  });
  const save = useSaveTargetChoice({
    persistTargetChoice,
    onClose: input.onClose,
    setInlineError: input.setInlineError,
    surfaceError,
  });
  const batch = useBatchRun({
    ...input,
    projectId,
    suiteTargets,
    noteInput,
    persistTargetChoice,
    surfaceError,
  });

  return {
    save,
    run: batch.run,
    hasAnyTarget,
    isSaving,
    isRunning: batch.isRunning,
    isBusy: isSaving || batch.isPending,
  };
}

export type RunDialogController = ReturnType<typeof useRunDialogSubmit>;
