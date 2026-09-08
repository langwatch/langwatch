/** Kept apart from the composition so the router/app type never pulls in the installer. */
import type { TopicApi } from "@langwatch/topic-contract";
import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createTopicTrpcRouter } from "./topic-trpc.mount.ts";

/** The one namespace and the reader `ctx.app.topics` carries. */
export type ComposedTopicFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createTopicTrpcRouter<ApiTrpcContext>>;
  /** For `ctx.app.topics` — the same reader the trace grid labels rows with. */
  app: TopicApi;
}>;
