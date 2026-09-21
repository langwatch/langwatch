import { z } from "zod";

/**
 * The freshness signal `experiments.onExperimentUpdate` streams when a
 * workbench save lands. Signal-then-refetch: it names WHAT changed and at
 * which version, never the state itself; the client compares versions and
 * refetches through the normal read path when it is behind.
 */
export const experimentUpdateSignalSchema = z.object({
  event: z.literal("experiment_updated"),
  experimentId: z.string(),
  slug: z.string(),
  version: z.number().int(),
  actorLabel: z.enum(["user", "langy", "api"]),
  /**
   * The run that wrote this version, when a run wrote it. The page that
   * started that run adopts the version rather than treating its own run's
   * write as a stranger's.
   */
  runId: z.string().optional(),
});

export type ExperimentUpdateSignal = z.infer<
  typeof experimentUpdateSignalSchema
>;
