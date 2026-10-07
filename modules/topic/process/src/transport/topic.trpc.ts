/**
 * The server half of `topics.*`: a permission and a handler per procedure.
 * A topic name derives from the messages clustered into it, so `getAll`
 * needs `traces:view`; clustering reads (describing the run) stay at `project:view`.
 */

import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { moduleApi } from "@langwatch/module";
import {
  topicTrpc,
  type TopicApi,
  type TopicClusteringTriggerResult,
} from "@langwatch/topic-contract";

/** What the topic browser door reaches: the topic application, and the manual trigger. */
export interface TopicBrowserApi {
  /** This module's own application, as the process composed it. */
  topics(): TopicApi;
  /** Requests a clustering run for `by`, reporting a request that did not land. */
  triggerTopicClustering(input: {
    projectId: string;
    by: Readonly<{ id: string }>;
  }): Promise<TopicClusteringTriggerResult>;
}

export const TopicBrowserApi = moduleApi<TopicBrowserApi>()("topic");

export const topicTrpcTransport: TrpcRouterDeclaration<TopicBrowserApi, typeof topicTrpc> =
  defineTrpcRouter(TopicBrowserApi, topicTrpc)
    .procedure("getAll")
    .withPermission("traces:view")
    .handle(async ({ app, input }) => app.topics().getAll({ projectId: input.projectId }))

    .procedure("getClusteringStatus")
    .withPermission("project:view")
    .handle(async ({ app, input }) =>
      app.topics().getClusteringStatus({ projectId: input.projectId }),
    )

    .procedure("getClusteringRunHistory")
    .withPermission("project:view")
    .handle(async ({ app, input }) =>
      app.topics().getClusteringRunHistory({ projectId: input.projectId }),
    )

    .procedure("triggerTopicClustering")
    .withPermission("project:update")
    .handle(({ app, input, actor }) =>
      app.triggerTopicClustering({ projectId: input.projectId, by: actor }),
    )
    .build();
