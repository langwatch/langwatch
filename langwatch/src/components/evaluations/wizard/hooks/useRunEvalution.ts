import { useStepCompletedValue } from "./useStepCompletedValue";
import { useEvaluationWizardStore } from "./useEvaluationWizardStore";
import { toaster } from "../../../../components/ui/toaster";
import type {
  StudioClientEvent,
  StudioServerEvent,
} from "../../../../optimization_studio/types/events";
import { useCallback, useEffect } from "react";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import { nanoid } from "nanoid";
import { usePostEvent } from "./usePostEvent";
import { useShallow } from "zustand/react/shallow";

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

  const postEvent = usePostEvent();

  const runEvaluation = useCallback(() => {
    if (!completedStepValue("all")) {
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
        workflow_version_id: workflow.version,
        evaluate_on: "full",
      },
    };
    postEvent(payload);
  }, [
    completedStepValue,
    getWorkflow,
    setWizardState,
    setEvaluationState,
    postEvent,
  ]);

  return { runEvaluation };
};
