import type { EventHandler, IntentSpec } from "@langwatch/eventing";
import { z } from "zod";

import type {
  ProjectionReplayRun,
  projectionReplayRunSchema,
} from "./ops-projection-replay.events.ts";

export const PROJECTION_REPLAY_PROCESS_NAME = "projectionReplay";

/** The replay lock's lifetime: the heartbeat keeps the lock, the lease bounds one delivery. */
export const PROJECTION_REPLAY_LEASE_MS = 3600 * 1000;

export const projectionReplayStateSchema = z.object({
  requestedAt: z.number().nullable(),
});
export type ProjectionReplayState = z.infer<typeof projectionReplayStateSchema>;

export const PROJECTION_REPLAY_INITIAL_STATE: ProjectionReplayState = { requestedAt: null };

export type ProjectionReplayIntents = {
  execute: IntentSpec<typeof projectionReplayRunSchema>;
};

/** Keyed by the run, so a redelivered request asks for its execution once. */
export const onProjectionReplayRequested: EventHandler<
  ProjectionReplayState,
  ProjectionReplayRun,
  ProjectionReplayIntents
> = (_state, run, ctx) => ({
  state: { requestedAt: ctx.at },
  intents: [ctx.intent("execute", `execute:${run.runId}`, run)],
});
