/**
 * The server half of `topics.*`. A topic name derives from the messages clustered into it, so
 * `getAll` and `getTopicCounts` need `traces:view`; clustering reads stay at `project:view`.
 */

import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { moduleApi } from "@langwatch/module";
import {
  topicTrpc,
  type NamedTopicCounts,
  type TopicApi,
  type TopicClusteringTriggerResult,
} from "@langwatch/topic-contract";
import type { traceFilterInputSchema } from "@langwatch/trace-contract";
import type { z } from "zod";

/** What the topic browser door reaches: the application, the manual trigger and the counts. */
export interface TopicBrowserApi {
  /** This module's own application, as the process composed it. */
  topics(): TopicApi;
  /** Requests a clustering run for `by`, reporting a request that did not land. */
  triggerTopicClustering(input: {
    projectId: string;
    by: Readonly<{ id: string }>;
  }): Promise<TopicClusteringTriggerResult>;
  /** Trace's per-topic counts under the filter, named from the project's topics. */
  getTopicCounts(input: z.infer<typeof traceFilterInputSchema>): Promise<NamedTopicCounts>;
}

export const TopicBrowserApi = moduleApi<TopicBrowserApi>()("topic");

export const topicTrpcTransport: TrpcRouterDeclaration<TopicBrowserApi, typeof topicTrpc> =
  defineTrpcRouter(TopicBrowserApi, topicTrpc)
    .procedure("getAll")
    .withPermission("traces:view")
    .handle(async ({ app, input }) => app.topics().getAll({ projectId: input.projectId }))

    .procedure("getTopicCounts")
    .withPermission("traces:view")
    .handle(({ app, input }) => app.getTopicCounts(input))

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
