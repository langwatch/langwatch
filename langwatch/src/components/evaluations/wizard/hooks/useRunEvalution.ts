import { useStepCompletedValue } from "./useStepCompletedValue";
import { useEvaluationWizardStore } from "./evaluation-wizard-store/useEvaluationWizardStore";
import { toaster } from "../../../../components/ui/toaster";
import type { StudioClientEvent } from "../../../../optimization_studio/types/events";
import { useCallback } from "react";
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

  const { postEvent, isLoading } = usePostEvent();

  const runEvaluation = useCallback(() => {
    // Log the dsl
    console.log(JSON.stringify(getWorkflow(), null, 2));
    if (!validateDSL(getWorkflow())) {
      return;
    }

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

  return { runEvaluation, isLoading };
};

/**
 * Validate the dsl before running the evaluation
 *
 * This should check that all of the edges have valid matching nodes.
 * If not, it should toast what's wrong.
 *
 * It should return a valid dsl
 */

const validateDSL = (dsl: Workflow) => {
  const errors: string[] = [];

  // Create a map of node IDs for O(1) lookup instead of O(n) find operations
  const nodeMap = new Map(dsl.nodes.map((node) => [node.id, node]));

  // Check that all edges have valid matching nodes
  for (const edge of dsl.edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
      errors.push(`Edge ${edge.id} has invalid source or target node`);
    }
  }

  if (errors.length > 0) {
    toaster.create({
      title: "Invalid DSL",
      description: errors.join("\n"),
    });
  }

  return dsl;
};
