/**
 * Run Evaluation Hook for V3
 *
 * Handles executing evaluations and streaming results back to the store.
 */

import { nanoid } from "nanoid";
import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { useAvailableEvaluators } from "../../../hooks/useAvailableEvaluators";
import { api } from "../../../utils/api";
import { toaster } from "../../../components/ui/toaster";
import { usePostEvent } from "../../../optimization_studio/hooks/usePostEvent";
import { useEvaluationV3Store } from "../store/useEvaluationV3Store";
import { stateToDSL } from "../utils/dslMapper";
import type { StudioClientEvent } from "../../../optimization_studio/types/events";
import type { EvaluationRun } from "../types";

export const useRunEvaluationV3 = () => {
  const { project } = useOrganizationTeamProject();
  const availableEvaluators = useAvailableEvaluators();
  const { postEvent, isLoading: isPostingEvent } = usePostEvent();

  const {
    getState,
    currentRun,
    setCurrentRun,
    updateRunProgress,
    addAgentResult,
    addEvaluatorResult,
    setRunStatus,
    setExperimentInfo,
    markUnsavedChanges,
  } = useEvaluationV3Store(
    useShallow((s) => ({
      getState: s.getState,
      currentRun: s.currentRun,
      setCurrentRun: s.setCurrentRun,
      updateRunProgress: s.updateRunProgress,
      addAgentResult: s.addAgentResult,
      addEvaluatorResult: s.addEvaluatorResult,
      setRunStatus: s.setRunStatus,
      setExperimentInfo: s.setExperimentInfo,
      markUnsavedChanges: s.markUnsavedChanges,
    }))
  );

  const commitVersion = api.workflow.commitVersion.useMutation();
  const generateCommitMessage = api.workflow.generateCommitMessage.useMutation();
  const trpc = api.useContext();

  const [timeoutTriggered, setTimeoutTriggered] = useState(false);

  // Handle timeout
  useEffect(() => {
    if (
      timeoutTriggered &&
      currentRun?.status === "running"
    ) {
      setRunStatus("error", "Execution timed out");
      setTimeoutTriggered(false);
    }
  }, [timeoutTriggered, currentRun, setRunStatus]);

  const runEvaluation = useCallback(
    async () => {
      if (!project || !availableEvaluators) {
        toaster.create({
          title: "Cannot run evaluation",
          description: "Project or evaluators not loaded",
          type: "error",
          meta: { closable: true },
        });
        return;
      }

      const state = getState();

      if (!state.workflowId) {
        toaster.create({
          title: "Please save the evaluation first",
          description: "The evaluation needs to be saved before running",
          type: "error",
          meta: { closable: true },
        });
        return;
      }

      // Validate configuration
      if (state.agents.length === 0) {
        toaster.create({
          title: "No agents configured",
          description: "Add at least one agent to run the evaluation",
          type: "error",
          meta: { closable: true },
        });
        return;
      }

      if (state.evaluators.length === 0) {
        toaster.create({
          title: "No evaluators configured",
          description: "Add at least one evaluator to run the evaluation",
          type: "error",
          meta: { closable: true },
        });
        return;
      }

      // Create the DSL
      const dsl = stateToDSL(state, availableEvaluators);

      // Generate a run ID
      const runId = `run_${nanoid()}`;

      // Calculate total entries
      const totalEntries =
        state.dataset.type === "inline"
          ? state.dataset.rows.filter((row) =>
              Object.values(row.values).some((v) => v !== "" && v !== null)
            ).length
          : 10; // Will be updated when we fetch saved dataset count

      // Create initial run state
      const newRun: EvaluationRun = {
        id: runId,
        status: "running",
        progress: 0,
        total: totalEntries,
        agentResults: [],
        evaluatorResults: [],
        timestamps: {
          startedAt: Date.now(),
        },
      };

      setCurrentRun(newRun);

      try {
        // Commit a new version for this run
        const commitMessage = "Evaluation run";
        const versionResponse = await commitVersion.mutateAsync({
          projectId: project.id,
          workflowId: state.workflowId,
          commitMessage,
          dsl,
        });

        // Update run with version ID
        setCurrentRun({
          ...newRun,
          versionId: versionResponse.id,
        });

        void trpc.workflow.getVersions.invalidate();

        // Send evaluation event
        const payload: StudioClientEvent = {
          type: "execute_evaluation",
          payload: {
            run_id: runId,
            workflow: dsl,
            workflow_version_id: versionResponse.id,
            evaluate_on: "full",
          },
        };

        postEvent(payload);

        // Set a timeout
        setTimeout(() => {
          setTimeoutTriggered(true);
        }, 300_000); // 5 minutes timeout
      } catch (error) {
        console.error("Failed to start evaluation:", error);
        setRunStatus("error", String(error));
        toaster.create({
          title: "Failed to start evaluation",
          description: String(error),
          type: "error",
          meta: { closable: true },
        });
      }
    },
    [
      project,
      availableEvaluators,
      getState,
      setCurrentRun,
      commitVersion,
      trpc.workflow.getVersions,
      postEvent,
      setRunStatus,
    ]
  );

  const stopEvaluation = useCallback(() => {
    if (!currentRun) return;

    const state = getState();
    const dsl = stateToDSL(state, availableEvaluators ?? {});

    const payload: StudioClientEvent = {
      type: "stop_evaluation_execution",
      payload: {
        workflow: dsl,
        run_id: currentRun.id,
      },
    };

    postEvent(payload);
    setRunStatus("stopped");
  }, [currentRun, getState, availableEvaluators, postEvent, setRunStatus]);

  return {
    runEvaluation,
    stopEvaluation,
    isRunning: currentRun?.status === "running",
    isLoading: commitVersion.isLoading || isPostingEvent,
  };
};

