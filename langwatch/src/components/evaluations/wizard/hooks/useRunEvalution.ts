import { useStepCompletedValue } from "./useStepCompletedValue";
import { useEvaluationWizardStore } from "./evaluation-wizard-store/useEvaluationWizardStore";
import { toaster } from "../../../../components/ui/toaster";
import type { StudioClientEvent } from "../../../../optimization_studio/types/events";
import { useCallback } from "react";
import { nanoid } from "nanoid";
import { usePostEvent } from "./usePostEvent";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../../../utils/api";
import { useForm } from "react-hook-form";
import { useVersionState } from "../../../../optimization_studio/components/History";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";

export const useRunEvalution = () => {
  const completedStepValue = useStepCompletedValue();
  const {
    workflowStore: { setEvaluationState, getWorkflow },
    setWizardState,
  } = useEvaluationWizardStore(
    useShallow((state) => ({
      workflowStore: {
        setEvaluationState: state.workflowStore.setEvaluationState,
        getWorkflow: state.workflowStore.getWorkflow,
      },
      setWizardState: state.setWizardState,
    }))
  );

  const { postEvent, isLoading } = usePostEvent();

  const { project } = useOrganizationTeamProject();

  const commitVersion = api.workflow.commitVersion.useMutation();

  const form = useForm({
    defaultValues: {
      version: "",
      commitMessage: "",
    },
  });

  const { previousVersion, nextVersion } = useVersionState({
    project,
    form: form,
    allowSaveIfAutoSaveIsCurrentButNotLatest: true,
  });

  const generateCommitMessage =
    api.workflow.generateCommitMessage.useMutation();

  const runEvaluation = useCallback(async () => {
    if (!project) return;

    const workflowId = getWorkflow().workflow_id;
    if (!completedStepValue("all") || !workflowId) {
      toaster.create({
        title: "Please complete all steps before running evaluation",
        type: "error",
        duration: 5000,
        meta: {
          closable: true,
        },
      });
      return;
    }

    const run_id = `run_${nanoid()}`;
    const workflow = getWorkflow();

    let commitMessage = previousVersion ? "autosaved" : "first version";
    if (previousVersion?.dsl) {
      try {
        const commitMessageResponse = await generateCommitMessage.mutateAsync({
          projectId: project?.id ?? "",
          prevDsl: previousVersion?.dsl,
          newDsl: getWorkflow(),
        });
        commitMessage = commitMessageResponse ?? "autosaved";
      } catch (error) {
        toaster.create({
          title: "Error auto-generating version description",
          type: "error",
          duration: 5000,
          meta: { closable: true },
        });
      }
    }

    let versionId: string;
    try {
      const versionResponse = await commitVersion.mutateAsync({
        projectId: project.id,
        workflowId,
        commitMessage,
        dsl: {
          ...getWorkflow(),
          version: nextVersion,
        },
      });
      versionId = versionResponse.id;
    } catch (error) {
      toaster.create({
        title: "Error saving version",
        type: "error",
        duration: 5000,
        meta: { closable: true },
        placement: "top-end",
      });
      throw error;
    }

    setWizardState({
      workspaceTab: "results",
    });
    setEvaluationState({
      status: "waiting",
      run_id,
      progress: 0,
      total: 0,
    });

    const payload: StudioClientEvent = {
      type: "execute_evaluation",
      payload: {
        run_id,
        workflow,
        // TODO: autosave and generate a new commit message and version id automatically
        workflow_version_id: versionId,
        evaluate_on: "full",
      },
    };
    postEvent(payload);
  }, [
    project,
    getWorkflow,
    completedStepValue,
    previousVersion,
    setWizardState,
    setEvaluationState,
    postEvent,
    generateCommitMessage,
    commitVersion,
    nextVersion,
  ]);

  return {
    runEvaluation,
    isLoading:
      isLoading || generateCommitMessage.isLoading || commitVersion.isLoading,
  };
};
