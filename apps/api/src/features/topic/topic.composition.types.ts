/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { TopicService } from "@langwatch/topic-contract";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createTopicTrpcRouter } from "./topic-trpc.mount";

/** The one namespace and the reader `ctx.app.topics` carries. */
export type ComposedTopicFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createTopicTrpcRouter>;
  /** For `ctx.app.topics` — the same reader the trace grid labels rows with. */
  service: TopicService;
}>;
