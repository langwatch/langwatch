/**
 * The server half of `insights.*`. Every procedure takes `analytics:view` on the project and
 * answers for the caller alone: an insight is its owner's, and the module refuses another's.
 * Each write is refused on an aggregate, which is read only (ADR-177 decision 8).
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
    .refusedOnAggregate()
    .withPermission("analytics:view")
    .handle(({ app, input, actor }) => app.fileInsight({ ...input, userId: actor.id }))

    .procedure("markSeen")
    .refusedOnAggregate()
    .withPermission("analytics:view")
    .handle(({ app, input, actor }) => app.markInsightsSeen({ ...input, userId: actor.id }))

    .procedure("archive")
    .refusedOnAggregate()
    .withPermission("analytics:view")
    .handle(({ app, input, actor }) => app.archiveInsight({ ...input, userId: actor.id }))

    .procedure("keep")
    .refusedOnAggregate()
    .withPermission("analytics:view")
    .handle(({ app, input, actor }) => app.keepInsight({ ...input, userId: actor.id }))
    .build();
