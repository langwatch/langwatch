/** Overrides for experiment-related views. */

import type { DatasetOverride } from "./lwql-dataset-derivation.rules.ts";

export const EXPERIMENTS_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
  experiment_runs: {
    description: "Experiment run results: completion counts, cost, and aggregate scores",
    grain: "one row per (RunId, ExperimentId)",
    timeColumn: "StartedAt",
    // Latest-in-order: a stock widget reads it (analytics ADR-006).
    dedup: {
      versionColumn: "UpdatedAt",
      strategy: "latest-in-order",
      tieBreakColumns: ["Version"],
    },
    columnUnits: {
      TotalDurationMs: "ms",
    },
  },
  experiment_run_items: {
    description: "Individual item results within an experiment run with evaluations",
    grain: "one row per (RunId, ProjectionId)",
    timeColumn: "OccurredAt",
    // Latest-in-order: a stock widget reads it (analytics ADR-006).
    dedup: { versionColumn: "OccurredAt", strategy: "latest-in-order" },
    columnUnits: {
      TargetDurationMs: "ms",
      EvaluationDurationMs: "ms",
    },
  },
  dspy_steps: {
    description: "DSPy optimizer steps with prompts, examples, and LLM call details",
    grain: "one row per (ExperimentId, RunId, StepIndex)",
    timeColumn: "CreatedAt",
    dedup: { versionColumn: "UpdatedAt" },
  },
};
