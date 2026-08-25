/**
 * The writes of the run plan editor: the two mutations that store a plan, and
 * the two ways of leaving the dialog, with and without a run.
 *
 * A refusal the server can name lands under the field it is about, and the
 * dialog stays open. Everything else falls back to a toast.
 *
 * @see specs/features/agent-testing/run-plan-editor.feature
 */

import { type MutableRefObject, useCallback, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { DrawerType } from "~/components/drawerRegistry";
import type { SuiteFormData } from "~/components/suites/useSuiteForm";
import { useSuiteRunMutation } from "~/components/suites/useSuiteRunMutation";
import { toaster } from "~/components/ui/toaster";
import {
  applyHandledErrorToForm,
  describeError,
  readHandledError,
  showErrorToast,
} from "~/features/errors";
import type { SimulationSuite } from "~/generated/prisma/client";
import { useDrawer } from "~/hooks/useDrawer";
import { api } from "~/utils/api";

/** What a run plan carries into the mutation, from the validated form. */
function buildMutationPayload(data: SuiteFormData, projectId: string) {
  return {
    projectId,
    name: data.name.trim(),
    description: data.description.trim() || undefined,
    scenarioIds: data.selectedScenarioIds,
    targets: data.selectedTargets,
    repeatCount: data.repeatCount,
    labels: data.labels,
    simulatorModel: data.simulatorModel,
    judgeModel: data.judgeModel,
  };
}

/** What a save asks of the caller once it lands. */
type PlanMutateOptions = { onSuccess: (saved: SimulationSuite) => void };
type PlanPayload = ReturnType<typeof buildMutationPayload>;
type PlanMutate = (input: PlanPayload, options?: PlanMutateOptions) => void;
type PlanMutateWithId = (
  input: PlanPayload & { id: string },
  options?: PlanMutateOptions,
) => void;

/** What a stored plan does: refresh the lists, hand it back, and say so. */
function onStored({
  utils,
  projectId,
  onSaved,
  closeDrawer,
  saveAndRunRef,
  title,
}: {
  utils: ReturnType<typeof api.useUtils>;
  projectId: string;
  onSaved?: (suite: SimulationSuite) => void;
  closeDrawer: () => void;
  saveAndRunRef: MutableRefObject<boolean>;
  title: string;
}) {
  return (data: SimulationSuite) => {
    void utils.suites.getAll.invalidate();
    void utils.suites.getById.invalidate({ projectId, id: data.id });
    // A save that is followed by a run closes and runs from its own callback.
    if (saveAndRunRef.current) {
      saveAndRunRef.current = false;
      return;
    }
    onSaved?.(data);
    closeDrawer();
    toaster.create({ title, type: "success" });
  };
}

/** What a refused plan does: name the field, or fall back to a toast. */
function onRefused({
  form,
  saveAndRunRef,
  fallbackTitle,
}: {
  form: UseFormReturn<SuiteFormData>;
  saveAndRunRef: MutableRefObject<boolean>;
  fallbackTitle: string;
}) {
  return (error: unknown) => {
    saveAndRunRef.current = false;
    // A name clash arrives as its own code, so it is placed by hand under
    // the field the person is looking at.
    if (readHandledError(error)?.code === "suite_name_taken") {
      form.setError(
        "name",
        { type: "server", message: describeError({ error }) },
        { shouldFocus: true },
      );
      return;
    }
    if (applyHandledErrorToForm({ error, form, hasFormErrorSlot: true }))
      return;
    showErrorToast({ error, fallbackTitle });
  };
}

export type PlanEditorWritesInput = {
  projectId: string;
  /** The stored plan being edited, or nothing for a new one. */
  suite: SimulationSuite | null | undefined;
  /** The react-hook-form instance the fields are bound to. */
  form: UseFormReturn<SuiteFormData>;
  /** Where the editor is opened from, so a saved plan can be handed back. */
  onSaved?: (suite: SimulationSuite) => void;
  onRunRequested?: (suite: SimulationSuite) => void;
  drawerKey: DrawerType;
};

/** Queues the mutation the plan needs: an update for a stored one, a create otherwise. */
function useStorePlan({
  projectId,
  suite,
  createMutation,
  updateMutation,
}: {
  projectId: string;
  suite: SimulationSuite | null | undefined;
  createMutation: { mutate: PlanMutate };
  updateMutation: { mutate: PlanMutateWithId };
}) {
  return useCallback(
    (data: SuiteFormData, options?: PlanMutateOptions) => {
      if (!projectId) return;
      const payload = buildMutationPayload(data, projectId);
      if (suite) {
        updateMutation.mutate({ ...payload, id: suite.id }, options);
        return;
      }
      createMutation.mutate(payload, options);
    },
    [projectId, suite, createMutation, updateMutation],
  );
}

export function usePlanEditorWrites({
  projectId,
  suite,
  form,
  onSaved,
  onRunRequested,
  drawerKey,
}: PlanEditorWritesInput) {
  const { closeDrawer, openDrawer } = useDrawer();
  const utils = api.useUtils();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const saveAndRunRef = useRef(false);

  const handleSuccess = useCallback(
    (title: string) =>
      onStored({
        utils,
        projectId,
        onSaved,
        closeDrawer,
        saveAndRunRef,
        title,
      }),
    [utils, projectId, onSaved, closeDrawer],
  );

  const handleError = useCallback(
    (fallbackTitle: string) =>
      onRefused({ form, saveAndRunRef, fallbackTitle }),
    [form],
  );

  const createMutation = api.suites.create.useMutation({
    onSuccess: handleSuccess("Run plan created"),
    onError: handleError("Couldn't create run plan"),
  });
  const updateMutation = api.suites.update.useMutation({
    onSuccess: handleSuccess("Run plan updated"),
    onError: handleError("Couldn't update run plan"),
  });
  const { runMutation } = useSuiteRunMutation({
    onEditSuite: (id) => openDrawer(drawerKey, { urlParams: { suiteId: id } }),
  });

  const store = useStorePlan({
    projectId,
    suite,
    createMutation,
    updateMutation,
  });

  const submitAndRun = useCallback(
    (data: SuiteFormData) => {
      saveAndRunRef.current = true;
      store(data, {
        onSuccess: (saved) => {
          saveAndRunRef.current = false;
          closeDrawer();
          if (onRunRequested) return onRunRequested(saved);
          runMutation.mutate({ projectId, id: saved.id, idempotencyKey });
        },
      });
    },
    [
      store,
      closeDrawer,
      onRunRequested,
      runMutation,
      projectId,
      idempotencyKey,
    ],
  );

  return {
    isSaving: createMutation.isPending || updateMutation.isPending,
    save: () => void form.handleSubmit((data) => store(data))(),
    saveAndRun: () => void form.handleSubmit(submitAndRun)(),
  };
}
