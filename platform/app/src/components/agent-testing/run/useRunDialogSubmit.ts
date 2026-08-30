import { useCallback } from "react";
import type { TargetValue } from "~/components/scenarios/TargetSelector";
import { readHandledError, showErrorToast } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useAllPromptsForProject } from "~/prompts/hooks/useAllPromptsForProject";
import type { SuiteTarget } from "~/server/suites/types";
import { api } from "~/utils/api";
import type { toLineRunParameters } from "./parameter-line";
import type { RunScope } from "./run-configuration";
import type {
  RunDialogSubject,
  RunStartedInfo,
  RunTarget,
} from "./run-dialog-types";
import { useBatchRun } from "./useRunDialogBatch";

/** The overrides a queued run carries, when the dialog collected any. */
type RunParameters = ReturnType<typeof toLineRunParameters>;

/**
 * The targets a suite run is written against: what was chosen, the overrides
 * it was chosen with, and the bindings the suite already held for it.
 *
 * A target of a comparison carries its own overrides. Outside a comparison
 * the one target carries the overrides of the parameter block.
 *
 * The bindings only survive while the same prompt stays selected, because
 * they bind a scenario to that prompt's inputs and mean nothing for another
 * one.
 */
function toSuiteTargets({
  runTargets,
  runParameters,
  secretParameterNames,
  persistedTarget,
}: {
  /** The agent, or the targets of a comparison. */
  runTargets: readonly RunTarget[];
  runParameters: RunParameters;
  /** The keys of the secret rows; their values are never written down. */
  secretParameterNames: string[] | undefined;
  persistedTarget?: SuiteTarget | null;
}): SuiteTarget[] | undefined {
  if (runTargets.length === 0) return undefined;

  return runTargets.map((target) => {
    const keepsMappings =
      target.type === "prompt" &&
      persistedTarget?.type === "prompt" &&
      persistedTarget.referenceId === target.id;

    const ownParameters = target.runParameters ?? runParameters;
    return {
      type: target.type,
      referenceId: target.id,
      ...(keepsMappings && persistedTarget.scenarioMappings
        ? { scenarioMappings: persistedTarget.scenarioMappings }
        : {}),
      ...(ownParameters ? { runParameters: ownParameters } : {}),
      ...(secretParameterNames
        ? { runSecretParameterNames: secretParameterNames }
        : {}),
    };
  });
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
  /**
   * The name the run goes out under.
   *
   * The server resolves it: a name that matches a plan joins that plan and
   * replaces its config, and a name that matches none creates a plan.
   */
  runName: string;
  /** The agent, or the targets of a comparison, each with its own overrides. */
  runTargets: readonly RunTarget[];
  /** What the run covers, which only the New run plan entry point chooses. */
  scope: RunScope;
  /** The scenarios that scope holds right now. */
  scopedScenarioIds: string[];
  repeatCount: number;
  simulatorModel: string | null;
  judgeModel: string | null;
  note: string;
  runParameters: RunParameters;
  /** The overrides the suite may remember: everything but the secrets. */
  storableRunParameters: RunParameters;
  /** The keys of the secret rows, which is all the suite may remember of them. */
  storableSecretNames: string[] | undefined;
  onRunStarted: (info: RunStartedInfo) => void;
  onClose: () => void;
  setInlineError: (error: unknown) => void;
  setMissingProvider: (missing: boolean) => void;
};

/** Whether the project has anything at all to run a scenario against. */
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

export function useRunDialogSubmit(input: RunDialogSubmitInput) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const suiteTargets = toSuiteTargets({
    runTargets: input.runTargets,
    runParameters: input.storableRunParameters,
    secretParameterNames: input.storableSecretNames,
    persistedTarget:
      input.subject?.kind === "suite" ? input.subject.persistedTarget : null,
  });
  const noteInput = toNoteInput(input.note);
  const hasAnyTarget = useHasAnyTarget(input.subject);
  const surfaceError = useSurfaceRunError(input.setInlineError);

  const batch = useBatchRun({
    ...input,
    projectId,
    suiteTargets,
    noteInput,
    surfaceError,
  });

  return {
    run: batch.run,
    hasAnyTarget,
    isBusy: batch.isBusy,
  };
}

export type RunDialogController = ReturnType<typeof useRunDialogSubmit>;
