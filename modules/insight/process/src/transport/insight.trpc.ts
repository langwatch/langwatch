/**
 * The server half of `insights.*`. Every procedure takes `analytics:view` on the project and
 * answers for the caller alone: an insight is its owner's, so filing one writes nothing a
 * teammate reads. The module refuses another person's insight; the door only names the caller.
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
    .withPermission("analytics:view")
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
