/**
 * The server half of `topics.*`: a permission and a handler per procedure.
 * A topic name derives from the messages clustered into it, so `getAll`
 * needs `traces:view`; clustering reads (describing the run) stay at `project:view`.
 */

import { defineTrpcRouter } from "@langwatch/api/trpc";
import { TopicApi, topicTrpc } from "@langwatch/topic-contract";

export const topicTrpcTransport = defineTrpcRouter(TopicApi, topicTrpc)
  .procedure("getAll")
  .withPermission("traces:view")
  .handle(async ({ app, input }) => app.getAll({ projectId: input.projectId }))

  .procedure("getClusteringStatus")
  .withPermission("project:view")
  .handle(async ({ app, input }) => app.getClusteringStatus({ projectId: input.projectId }))

  .procedure("getClusteringRunHistory")
  .withPermission("project:view")
  .handle(async ({ app, input }) => app.getClusteringRunHistory({ projectId: input.projectId }))
  .build();
