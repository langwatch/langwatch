/** The workbench state a browser run executes, built from the posted setup. */
import {
  createInitialUIState,
  type EvaluationsV3State,
  type executionRequestSchema,
} from "@langwatch/experiment-contract";
import type { z } from "zod";

export function workbenchRunState(
  input: z.infer<typeof executionRequestSchema>,
): EvaluationsV3State {
  return {
    name: input.name,
    // The wire's column `type` is a plain string and the state's is the
    // narrowed union, which is the same widening the two casts below carry.
    datasets: [input.dataset as EvaluationsV3State["datasets"][number]],
    activeDatasetId: input.dataset.id ?? "dataset-1",
    targets: input.targets as EvaluationsV3State["targets"],
    evaluators: input.evaluators as EvaluationsV3State["evaluators"],
    results: {
      status: "running",
      targetOutputs: {},
      targetMetadata: {},
      evaluatorResults: {},
      errors: {},
    },
    pendingSavedChanges: {},
    ui: createInitialUIState(),
  };
}
