/**
 * The server half of `insights.*`. Reading and keeping your own inbox takes `analytics:view`;
 * filing an insight the whole team sees takes `analytics:manage`.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { InsightApi, insightTrpc } from "@langwatch/insight-contract";

export const insightTrpcTransport: TrpcRouterDeclaration<InsightApi, typeof insightTrpc> =
  defineTrpcRouter(InsightApi, insightTrpc)
    .procedure("getAll")
    .withPermission("analytics:view")
    .handle(({ app, input, actor }) =>
      app.findInsights({ projectId: input.projectId, userId: actor.id }),
    )

    .procedure("file")
    .withPermission("analytics:manage")
    .handle(({ app, input, actor }) => app.fileInsight({ ...input, userId: actor.id }))

    .procedure("markSeen")
    .withPermission("analytics:view")
    .handle(({ app, input, actor }) => app.markInsightsSeen({ ...input, userId: actor.id }))

    .procedure("archive")
    .withPermission("analytics:view")
    .handle(({ app, input, actor }) => app.archiveInsight({ ...input, userId: actor.id }))

    .procedure("keep")
    .withPermission("analytics:view")
    .handle(({ app, input, actor }) => app.keepInsight({ ...input, userId: actor.id }))
    .build();
