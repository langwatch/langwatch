import {
  evaluatorResultDataSchema,
  runCompletedDataSchema,
  runStartedDataSchema,
  targetResultDataSchema,
} from "./schema";

/** `lw.experiment_run.*` is already in `event_log`; this pair is what keeps
 * the derived strings byte-equal to it. */
export const EXPERIMENT_RUN_PIPELINE_NAME = "experiment_run";
export const EXPERIMENT_RUN_PIPELINE_PREFIX = "lw";

export const experimentRunEvents = {
  started: runStartedDataSchema,
  targetResult: targetResultDataSchema,
  evaluatorResult: evaluatorResultDataSchema,
  completed: runCompletedDataSchema,
} as const;
