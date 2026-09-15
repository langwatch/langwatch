/**
 * Overrides for experiment-related datasets.
 *
 * - experiment_runs: free table of run results per experiment
 * - experiment_run_items: per-item evaluation results with input/output gating
 * - dspy_steps: dspy optimizer steps with LLM calls and parameters gated as output
 */

import type { Partial } from "lodash";
import type { DatasetOverride } from "../defineDatasetFromTable";

export const EXPERIMENTS_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
  experiment_runs: {
    description:
      "Experiment run results: completion counts, cost, and aggregate scores",
    grain: "one row per (RunId, ExperimentId)",
    columnGates: {
      TotalCost: ["costs"],
    },
  },
  experiment_run_items: {
    description:
      "Individual item results within an experiment run with evaluations",
    grain: "one row per (RunId, ProjectionId)",
    columnGates: {
      DatasetEntry: ["input"],
      EvaluationInputs: ["input"],
      Predicted: ["output"],
      TargetError: ["output"],
      EvaluationDetails: ["output"],
      TargetCost: ["costs"],
      EvaluationCost: ["costs"],
    },
  },
  dspy_steps: {
    description:
      "DSPy optimizer steps with prompts, examples, and LLM call details",
    grain: "one row per (ExperimentId, RunId, StepIndex)",
    columnGates: {
      Predictors: ["output"],
      Examples: ["output"],
      LlmCalls: ["output"],
      OptimizerParameters: ["output"],
      LlmCallsTotalCost: ["costs"],
    },
  },
};
