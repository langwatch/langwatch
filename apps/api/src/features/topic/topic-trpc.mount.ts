/** Binds the feature's declared procedures to this process's execution path. */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import type { TopicApi } from "@langwatch/topic-contract";
import { topicTrpcTransport } from "@langwatch/topic-server";

/** The one slice of the process context this namespace reads. */
export interface TopicHostContext {
  app: Readonly<{ topics: TopicApi }>;
}

/** Mounts `topics.*` on the app process's tRPC root. */
export function createTopicTrpcRouter<TContext extends TopicHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(topicTrpcTransport, (ctx) => ctx.app.topics);
}
