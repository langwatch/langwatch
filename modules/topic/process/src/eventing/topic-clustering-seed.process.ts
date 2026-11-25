import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const TOPIC_CLUSTERING_SEED_PROCESS_NAME = "topicClusteringSeed";

/** Main ran both seeds once per worker start and had no cadence of its own; hourly replaces it. */
export const TOPIC_CLUSTERING_SEED_INTERVAL_MS = 60 * 60 * 1000;

export const topicClusteringSeedSchema = z.object({
  scheduledFor: z.number().int(),
});

export const topicClusteringSeedStateSchema = z.object({
  lastSeededAt: z.number().nullable(),
});
type TopicClusteringSeedState = z.infer<typeof topicClusteringSeedStateSchema>;

export const TOPIC_CLUSTERING_SEED_INITIAL_STATE: TopicClusteringSeedState = {
  lastSeededAt: null,
};

type TopicClusteringSeedIntents = {
  seedTopicModels: IntentSpec<typeof topicClusteringSeedSchema>;
  seedSchedules: IntentSpec<typeof topicClusteringSeedSchema>;
};

/** Keyed by the wake, so a redelivered wake asks for each seed pass once. */
export const topicClusteringSeedWake: WakeHandler<
  TopicClusteringSeedState,
  TopicClusteringSeedIntents
> = (_state, ctx) => ({
  state: { lastSeededAt: ctx.at },
  intents: [
    ctx.intent("seedTopicModels", `topics:${ctx.at}`, { scheduledFor: ctx.at }),
    ctx.intent("seedSchedules", `schedules:${ctx.at}`, { scheduledFor: ctx.at }),
  ],
});
