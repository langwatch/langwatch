import { useCallback } from "react";
import type { TargetValue } from "~/components/scenarios/TargetSelector";
import { readHandledError, showErrorToast } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { writeScenarioTarget } from "~/hooks/useScenarioTarget";
import { useAllPromptsForProject } from "~/prompts/hooks/useAllPromptsForProject";
import { api } from "~/utils/api";
import { useAgentTestingStore } from "../useAgentTestingStore";
import type { toLineRunParameters } from "./parameter-line";
import type { RunDialogSubject, RunStartedInfo } from "./run-dialog-types";
import { useBatchRun } from "./useRunDialogBatch";

/** The overrides a queued run carries, when the dialog collected any. */
type RunParameters = ReturnType<typeof toLineRunParameters>;

/** The targets a suite run is written against. */
function toSuiteTargets(target: TargetValue) {
  if (!target) return undefined;
  return [{ type: target.type, referenceId: target.id }];
}

export type SuiteTargets = ReturnType<typeof toSuiteTargets>;

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
