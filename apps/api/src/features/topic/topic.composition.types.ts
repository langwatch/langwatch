/**
 * ComposedTopicFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
import type { TopicService } from "@langwatch/topic-contract";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createTopicTrpcRouter } from "./topic-trpc.mount";

/** The one namespace and the reader `ctx.app.topics` carries. */
export type ComposedTopicFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createTopicTrpcRouter>;
  /** For `ctx.app.topics` — the same reader the trace grid labels rows with. */
  service: TopicService;
}>;
