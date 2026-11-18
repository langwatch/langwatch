import type { DSPyRunsSummary, ExperimentDspyStepSummary } from "@langwatch/experiment-contract";

/** Groups a project's DSPy steps by run into run summaries, newest run first. */
export function summariseDspyRuns({
  steps,
  versions,
}: {
  steps: ExperimentDspyStepSummary[];
  versions: Record<string, DSPyRunsSummary["workflow_version"]>;
}): DSPyRunsSummary[] {
  const stepsByRun = new Map<string, ExperimentDspyStepSummary[]>();
  for (const step of steps) {
    const runSteps = stepsByRun.get(step.runId) ?? [];
    runSteps.push(step);
    stepsByRun.set(step.runId, runSteps);
  }

  return Array.from(stepsByRun, ([runId, runSteps]) => {
    const versionId = runSteps.find((step) => step.workflowVersionId)?.workflowVersionId;

    return {
      runId,
      workflow_version: versionId ? versions[versionId] : void 0,
      steps: runSteps
        .map((step) => ({
          run_id: step.runId,
          index: step.stepIndex,
          score: step.score,
          label: step.label,
          optimizer: { name: step.optimizerName },
          llm_calls_summary: {
            total: step.llmCallsTotal,
            total_tokens: step.llmCallsTotalTokens,
            total_cost: step.llmCallsTotalCost,
          },
          timestamps: { created_at: step.createdAt },
        }))
        .toSorted((a, b) => a.timestamps.created_at - b.timestamps.created_at),
      created_at: Math.min(...runSteps.map((step) => step.createdAt)),
    };
  }).toSorted((a, b) => b.created_at - a.created_at);
}
