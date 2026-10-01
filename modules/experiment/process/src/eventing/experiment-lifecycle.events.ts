import { EventSchema } from "@langwatch/eventing";
import {
  EXPERIMENT_RAN_EVENT_TYPE,
  EXPERIMENT_RAN_EVENT_VERSION,
  experimentRanEventDataSchema,
} from "@langwatch/experiment-contract";
import { z } from "zod";

export const RECORD_EXPERIMENT_RAN_COMMAND_TYPE = "lw.experiment.record_ran" as const;

export const recordExperimentRanCommandDataSchema = experimentRanEventDataSchema;
export type RecordExperimentRanCommandData = z.infer<typeof recordExperimentRanCommandDataSchema>;

export const experimentRanEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(EXPERIMENT_RAN_EVENT_TYPE),
  version: z.literal(EXPERIMENT_RAN_EVENT_VERSION),
  data: experimentRanEventDataSchema,
});
export type ExperimentRanEvent = z.infer<typeof experimentRanEventSchema>;
export type ExperimentLifecycleEvent = ExperimentRanEvent;
