import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

export const PROJECTION_REPLAY_PIPELINE_NAME = "ops_projection_replay";
export const PROJECTION_REPLAY_AGGREGATE_TYPE = "projection_replay";
export const PROJECTION_REPLAY_REQUESTED_EVENT_TYPE = "lw.ops.projection_replay.requested";
export const PROJECTION_REPLAY_REQUESTED_EVENT_VERSION = "2026-09-28";

/** One operator-started replay run, as `startReplay` recorded it running. */
export const projectionReplayRunSchema = z.object({
  runId: z.string(),
  projectionNames: z.array(z.string()),
  since: z.string(),
  tenantIds: z.array(z.string()),
  aggregateIds: z.array(z.string()).optional(),
  fullRebuild: z.boolean().optional(),
  description: z.string(),
  userName: z.string(),
});
export type ProjectionReplayRun = z.infer<typeof projectionReplayRunSchema>;

/** A replay the api recorded running, for a worker to execute; who asked is the tenant. */
export const projectionReplayRequestedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(PROJECTION_REPLAY_REQUESTED_EVENT_TYPE),
  version: z.literal(PROJECTION_REPLAY_REQUESTED_EVENT_VERSION),
  data: projectionReplayRunSchema,
});
export type ProjectionReplayRequestedEvent = z.infer<typeof projectionReplayRequestedEventSchema>;
