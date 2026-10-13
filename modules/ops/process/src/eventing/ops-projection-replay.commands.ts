import { defineCommand } from "@langwatch/eventing";

import {
  PROJECTION_REPLAY_AGGREGATE_TYPE,
  PROJECTION_REPLAY_REQUESTED_EVENT_TYPE,
  PROJECTION_REPLAY_REQUESTED_EVENT_VERSION,
  projectionReplayRunSchema,
} from "./ops-projection-replay.events.ts";

/**
 * Hands a started replay to a worker. Its tenant is the operator's user id, which the event
 * store places on the shared cluster; the run is its own aggregate, so a resend is one event.
 */
export const RequestProjectionReplayCommand = defineCommand({
  commandType: "lw.ops.projection_replay.request",
  eventType: PROJECTION_REPLAY_REQUESTED_EVENT_TYPE,
  eventVersion: PROJECTION_REPLAY_REQUESTED_EVENT_VERSION,
  aggregateType: PROJECTION_REPLAY_AGGREGATE_TYPE,
  schema: projectionReplayRunSchema,
  aggregateId: (run) => run.runId,
  idempotencyKey: (run) => `projection_replay:${run.runId}`,
  makeJobId: (run) => `projection_replay:${run.runId}`,
});
