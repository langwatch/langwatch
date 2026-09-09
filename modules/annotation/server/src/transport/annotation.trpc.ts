/**
 * The server half of `annotation.*`: a permission and a handler per procedure
 * the contract already named. Names, kinds and schemas are not repeated here.
 */

import { AnnotationApi, annotationTrpc } from "@langwatch/annotation-contract";
import { defineTrpcRouter } from "@langwatch/api/trpc";

export const annotationTrpcTransport = defineTrpcRouter(AnnotationApi, annotationTrpc)
  .procedure("create")
  .withPermission("annotations:create")
  .handle(async ({ input, app, actor }) =>
    app.createReview({
      actorId: actor.id,
      projectId: input.projectId,
      traceId: input.traceId,
      comment: input.comment,
      isThumbsUp: input.isThumbsUp,
      scoreOptions: input.scoreOptions ?? {},
      expectedOutput: input.expectedOutput,
      anchorKind: input.anchorKind,
      anchorId: input.anchorId,
      anchorPath: input.anchorPath,
    }),
  )

  .procedure("updateByTraceId")
  .withPermission("annotations:update")
  .handle(async ({ input, app, actor }) =>
    app.updateReview({
      actorId: actor.id,
      id: input.id,
      projectId: input.projectId,
      traceId: input.traceId,
      comment: input.comment,
      isThumbsUp: input.isThumbsUp,
      scoreOptions: input.scoreOptions ?? {},
      expectedOutput: input.expectedOutput,
    }),
  )

  .procedure("getByTraceId")
  .withPermission("annotations:view")
  .handle(async ({ app, input }) =>
    app.listWithUserSummaries({
      projectId: input.projectId,
      traceIds: [input.traceId],
      anchor: input.anchor,
      order: "asc",
    }),
  )

  .procedure("getByTraceIds")
  .withPermission("annotations:view")
  .handle(async ({ app, input }) =>
    app.listWithUserSummaries({
      projectId: input.projectId,
      traceIds: input.traceIds,
      anchor: input.anchor,
      order: "asc",
    }),
  )

  .procedure("getById")
  .withPermission("annotations:view")
  .handle(async ({ app, input }) =>
    app.getById({
      id: input.annotationId,
      projectId: input.projectId,
    }),
  )

  .procedure("deleteById")
  .withPermission("annotations:delete")
  .handle(async ({ app, input }) =>
    app.deleteReview({
      projectId: input.projectId,
      annotationId: input.annotationId,
    }),
  )

  .procedure("getAll")
  .withPermission("annotations:view")
  .handle(async ({ app, input }) =>
    app.listWithFullUsers({
      projectId: input.projectId,
      anchor: "all",
      order: "desc",
      startDate: input.startDate,
      endDate: input.endDate,
    }),
  )

  .procedure("createOrUpdateQueue")
  .withPermission("annotations:create")
  .handle(async ({ app, input }) => app.configure(input))

  .procedure("getQueues")
  .withPermission("annotations:view")
  .handle(async ({ app, actor, input }) =>
    app.listQueues({
      projectId: input.projectId,
      ...(input.reachableOnly === true ? { reachableOnly: true, userId: actor.id } : {}),
    }),
  )

  .procedure("getQueueItems")
  .withPermission("annotations:view")
  .handle(async ({ app, actor, input }) =>
    app.listReviewQueueItems({
      projectId: input.projectId,
      userId: actor.id,
    }),
  )

  .procedure("getPendingItemsCount")
  .withPermission("annotations:view")
  .handle(async ({ app, actor, input }) => ({
    count: await app.countPendingItems({
      projectId: input.projectId,
      userId: actor.id,
    }),
  }))

  .procedure("getAssignedItemsCount")
  .withPermission("annotations:view")
  .handle(async ({ app, actor, input }) => ({
    count: await app.countAssignedItems({
      projectId: input.projectId,
      userId: actor.id,
    }),
  }))

  .procedure("getQueueItemsCounts")
  .withPermission("annotations:view")
  .handle(async ({ app, actor, input }) =>
    app.listMemberQueuePendingCounts({
      projectId: input.projectId,
      userId: actor.id,
    }),
  )

  .procedure("createQueueItem")
  .withPermission("annotations:create")
  .handle(async ({ app, actor, input }) =>
    app.queueTraces({
      traceIds: input.traceIds,
      projectId: input.projectId,
      annotators: input.annotators,
      userId: actor.id,
    }),
  )

  .procedure("deleteQueueItems")
  .withPermission("annotations:update")
  .handle(async ({ app, actor, input }) => {
    const deleted = await app.deleteQueueItems({
      projectId: input.projectId,
      userId: actor.id,
      queueItemIds: input.queueItemIds,
    });

    return { deleted };
  })

  .procedure("markQueueItemDone")
  .withPermission("annotations:update")
  .handle(async ({ app, actor, input }) =>
    app.markQueueItemDone({
      projectId: input.projectId,
      userId: actor.id,
      queueItemId: input.queueItemId,
    }),
  )

  .procedure("getQueueBySlugOrId")
  .withPermission("annotations:view")
  .handle(async ({ app, input }) =>
    app.getQueue({
      projectId: input.projectId,
      slug: input.slug,
      queueId: input.queueId,
    }),
  )

  .procedure("getOptimizedAnnotationQueues")
  .withPermission("annotations:view")
  .handle(async ({ app, actor, input }) =>
    app.listOptimizedQueues({
      ...input,
      userId: actor.id,
    }),
  )
  .build();
