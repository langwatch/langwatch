import { z } from "zod";

/** Experiment's lifecycle facts, which peers react to from their own side (§9). */
export const EXPERIMENT_LIFECYCLE_PIPELINE_NAME = "experiment_lifecycle" as const;
export const EXPERIMENT_LIFECYCLE_AGGREGATE_TYPE = "experiment_lifecycle" as const;
export const EXPERIMENT_RAN_EVENT_TYPE = "lw.experiment.ran" as const;
export const EXPERIMENT_RAN_EVENT_VERSION = "2026-09-30" as const;

/** A person's workbench run ended (done or stopped): whose, where, and whether it was in full. */
export const experimentRanEventDataSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  userId: z.string().min(1),
  projectId: z.string().min(1),
  experimentId: z.string().nullish(),
  fullRun: z.boolean(),
});
export type ExperimentRanEventData = z.infer<typeof experimentRanEventDataSchema>;
