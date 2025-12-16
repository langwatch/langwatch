/**
 * Evaluation Events Hook for V3
 *
 * Listens for evaluation events from the backend and updates the store.
 */

import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { api } from "../../../utils/api";
import { useEvaluationV3Store } from "../store/useEvaluationV3Store";
import type { ESBatchEvaluation } from "../../../server/experiments/types";

/**
 * Poll for evaluation results and update the store
 */
export const useEvaluationEventsV3 = () => {
  const { project } = useOrganizationTeamProject();

  const {
    experimentId,
    currentRun,
    updateRunProgress,
    addAgentResult,
    addEvaluatorResult,
    setRunStatus,
  } = useEvaluationV3Store(
    useShallow((s) => ({
      experimentId: s.experimentId,
      currentRun: s.currentRun,
      updateRunProgress: s.updateRunProgress,
      addAgentResult: s.addAgentResult,
      addEvaluatorResult: s.addEvaluatorResult,
      setRunStatus: s.setRunStatus,
    }))
  );

  const runId = currentRun?.id;
  const isRunning = currentRun?.status === "running";

  // Poll for results when running
  const results = api.experiments.getExperimentBatchEvaluationRun.useQuery(
    {
      projectId: project?.id ?? "",
      experimentId: experimentId ?? "",
      runId: runId ?? "",
    },
    {
      enabled: !!project && !!experimentId && !!runId && isRunning,
      refetchInterval: 1000, // Poll every second while running
      refetchOnWindowFocus: false,
    }
  );

  // Process results when they arrive
  useEffect(() => {
    if (!results.data || !currentRun) return;

    const data = results.data;

    // Update progress
    const progress = data.progress;
    const total = data.total;
    if (progress != null && total != null) {
      updateRunProgress(progress, total);
    }

    // Check if finished
    if (data.timestamps.finished_at) {
      setRunStatus("completed");
    } else if (data.timestamps.stopped_at) {
      setRunStatus("stopped");
    }

    // Process dataset results (agent outputs)
    for (const entry of data.dataset) {
      // Check if we already have this result
      const existingResult = currentRun.agentResults.find(
        (r) => r.rowIndex === entry.index
      );

      if (!existingResult && entry.predicted) {
        // For each agent's predicted output
        for (const [agentId, outputs] of Object.entries(entry.predicted)) {
          addAgentResult({
            rowIndex: entry.index,
            agentId,
            outputs: outputs as Record<string, unknown>,
            cost: entry.cost ?? undefined,
            duration: entry.duration ?? undefined,
            error: entry.error ?? undefined,
            traceId: entry.trace_id ?? undefined,
          });
        }
      }
    }

    // Process evaluation results
    for (const evaluation of data.evaluations) {
      // Check if we already have this result
      const existingResult = currentRun.evaluatorResults.find(
        (r) =>
          r.rowIndex === evaluation.index &&
          r.evaluatorId === evaluation.evaluator
      );

      if (!existingResult) {
        // Determine which agent this evaluation is for
        // For now, we'll associate with all agents
        const agentIds = [
          ...new Set(
            currentRun.agentResults
              .filter((r) => r.rowIndex === evaluation.index)
              .map((r) => r.agentId)
          ),
        ];

        for (const agentId of agentIds.length > 0 ? agentIds : [""]) {
          addEvaluatorResult({
            rowIndex: evaluation.index,
            evaluatorId: evaluation.evaluator,
            agentId,
            score: evaluation.score ?? undefined,
            passed: evaluation.passed ?? undefined,
            label: evaluation.label ?? undefined,
            details: evaluation.details ?? undefined,
            cost: evaluation.cost ?? undefined,
            duration: evaluation.duration ?? undefined,
            status: evaluation.status,
          });
        }
      }
    }
  }, [
    results.data,
    currentRun,
    updateRunProgress,
    addAgentResult,
    addEvaluatorResult,
    setRunStatus,
  ]);
};

