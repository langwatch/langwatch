/**
 * What the run plan editor reads and writes: the plan itself, the test cases
 * and targets it can hold, and the two mutations that save it.
 *
 * The form state is the shared suite form, so the editor keeps every field a
 * run plan has ever carried. Only the way it is drawn is new.
 *
 * @see specs/features/agent-testing/run-plan-editor.feature
 */

import { useCallback, useRef, useState } from "react";
import { type SuiteFormData, useSuiteForm } from "~/components/suites/useSuiteForm";
import { useSuiteRunMutation } from "~/components/suites/useSuiteRunMutation";
import { useArchivedItemsResolution } from "~/components/suites/useArchivedItemsResolution";
import { toaster } from "~/components/ui/toaster";
import {
  applyHandledErrorToForm,
  describeError,
  readHandledError,
  showErrorToast,
} from "~/features/errors";
import type { SimulationSuite } from "~/generated/prisma/client";
import { getFlowCallbacks, useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

import { api } from "~/utils/api";

/** The key the run plan editor is opened under. */
export const PLAN_EDITOR_DRAWER = "agentTestingPlanEditor";

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

export type PlanEditorState = ReturnType<typeof usePlanEditor>;

export function usePlanEditor() {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, drawerOpen, openDrawer } = useDrawer();
  const params = useDrawerParams();
  const utils = api.useUtils();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  // A save that is followed by a run leaves the closing and the run to its own
  // callback, so the shared success path stands down for that one save.
  const saveAndRunRef = useRef(false);

  const isOpen = drawerOpen(PLAN_EDITOR_DRAWER);
  const suiteId = params.suiteId;
  const isEditing = !!suiteId;

  const callbacks = getFlowCallbacks(PLAN_EDITOR_DRAWER);
  const onSaved = callbacks?.onSaved;
  const onRunRequested = callbacks?.onRunRequested;

  const { data: suite, isLoading: isSuiteLoading } =
    api.suites.getById.useQuery(
      { projectId: project?.id ?? "", id: suiteId ?? "" },
      { enabled: !!project && !!suiteId && isOpen },
    );

  const { data: scenarios } = api.scenarios.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project && isOpen },
  );
  const { data: agents } = api.agents.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project && isOpen },
  );
  const { data: prompts } = api.prompts.getAllPromptsForProject.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project && isOpen },
  );
  const { data: folders } = api.suites.folders.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project && isOpen },
  );

  const suiteForm = useSuiteForm({
    suite: suite ?? null,
    isOpen,
    suiteId,
    scenarios,
    agents,
    prompts,
  });
  const { form } = suiteForm;

  const { archivedScenariosWithNames, archivedTargetsWithNames } =
    useArchivedItemsResolution({
      archivedScenarioIds: suiteForm.archivedScenarioIds,
      archivedTargets: suiteForm.archivedTargets,
      projectId: project?.id,
    });

  /**
   * Puts a taken-name rejection under the field the person is looking at, and
   * says whether it did so the caller can skip the toast.
   */
  const applyNameTakenToForm = (error: unknown): boolean => {
    if (readHandledError(error)?.code !== "suite_name_taken") return false;
    form.setError(
      "name",
      { type: "server", message: describeError({ error }) },
      { shouldFocus: true },
    );
    return true;
  };

  const handleError = (fallbackTitle: string) => (error: unknown) => {
    saveAndRunRef.current = false;
    if (applyNameTakenToForm(error)) return;
    if (applyHandledErrorToForm({ error, form, hasFormErrorSlot: true })) return;
    showErrorToast({ error, fallbackTitle });
  };

  const createMutation = api.suites.create.useMutation({
    onSuccess: (data) => {
      void utils.suites.getAll.invalidate();
      if (saveAndRunRef.current) {
        saveAndRunRef.current = false;
        return;
      }
      onSaved?.(data);
      closeDrawer();
      toaster.create({ title: "Run plan created", type: "success" });
    },
    onError: handleError("Couldn't create run plan"),
  });

  const updateMutation = api.suites.update.useMutation({
    onSuccess: (data) => {
      void utils.suites.getAll.invalidate();
      void utils.suites.getById.invalidate({
        projectId: project?.id ?? "",
        id: data.id,
      });
      if (saveAndRunRef.current) {
        saveAndRunRef.current = false;
        return;
      }
      onSaved?.(data);
      closeDrawer();
      toaster.create({ title: "Run plan updated", type: "success" });
    },
    onError: handleError("Couldn't update run plan"),
  });

  const { runMutation } = useSuiteRunMutation({
    onEditSuite: (id) => openDrawer(PLAN_EDITOR_DRAWER, { urlParams: { suiteId: id } }),
  });

  const submitForm = useCallback(
    (data: SuiteFormData) => {
      if (!project) return;
      const payload = buildMutationPayload(data, project.id);
      if (isEditing && suite) {
        updateMutation.mutate({ ...payload, id: suite.id });
      } else {
        createMutation.mutate(payload);
      }
    },
    [project, isEditing, suite, createMutation, updateMutation],
  );

  const submitAndRun = useCallback(
    (data: SuiteFormData) => {
      if (!project) return;
      const payload = buildMutationPayload(data, project.id);

      const onSuccess = (saved: SimulationSuite) => {
        saveAndRunRef.current = false;
        closeDrawer();
        if (onRunRequested) {
          onRunRequested(saved);
          return;
        }
        runMutation.mutate({
          projectId: payload.projectId,
          id: saved.id,
          idempotencyKey,
        });
      };

      saveAndRunRef.current = true;
      if (isEditing && suite) {
        updateMutation.mutate({ ...payload, id: suite.id }, { onSuccess });
      } else {
        createMutation.mutate(payload, { onSuccess });
      }
    },
    [
      project,
      isEditing,
      suite,
      createMutation,
      updateMutation,
      closeDrawer,
      onRunRequested,
      runMutation,
      idempotencyKey,
    ],
  );

  return {
    isOpen,
    close: closeDrawer,
    /** True while a stored plan is still being read. */
    isLoading: isEditing && isSuiteLoading,
    isEditing,
    /**
     * True for a plan whose scope is fixed: a test suite runs the cases filed
     * under it, so its case list is not picked in this dialog.
     */
    isFixedScope: suite?.kind === "folder",
    suiteName: suite?.name ?? "",
    suiteForm,
    folders,
    prompts,
    archivedScenariosWithNames,
    archivedTargetsWithNames,
    isSaving: createMutation.isPending || updateMutation.isPending,
    save: () => void form.handleSubmit(submitForm)(),
    saveAndRun: () => void form.handleSubmit(submitAndRun)(),
  };
}
