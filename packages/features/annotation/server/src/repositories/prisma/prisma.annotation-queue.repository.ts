/**
 * The `AnnotationQueue` and `AnnotationQueueItem` rows, over Prisma.
 *
 * The queue rows are not Annotation's own aggregate — a queue names users and
 * annotation scores, and its items name traces — so the transport reads them
 * through the {@link AnnotationQueueStore} port rather than through
 * `AnnotationService`. This is that port's Postgres implementation, moved out
 * of the application process unchanged: every filter, include, ordering and
 * return shape is the one the reviewer's pages have always been served.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AnnotationQueueStore } from "../../transport/api-trpc/annotation.api";

/**
 * Every queue item the caller's organization can see: one whose queue belongs
 * to this project, and whose assignee is a member of the organization the
 * project belongs to.
 */
const queueItemReferenceFilter = ({
  projectId,
  organizationId,
}: {
  projectId: string;
  organizationId: string;
}) => ({
  projectId,
  AND: [
    {
      OR: [{ annotationQueueId: null }, { annotationQueue: { projectId } }],
    },
    {
      OR: [
        { userId: null },
        {
          user: {
            orgMemberships: { some: { organizationId } },
          },
        },
      ],
    },
  ],
});

/**
 * The list's date range, as a `where` fragment. A queue item is dated by when
 * it was queued, which is what the reviewer sees in the list and filters on.
 * Empty when no range was asked for, so it spreads into a `where` either way.
 */
const queuedAtRangeFilter = ({
  startDate,
  endDate,
}: {
  startDate?: Date;
  endDate?: Date;
}): { createdAt?: { gte?: Date; lte?: Date } } => {
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (startDate) createdAt.gte = startDate;
  if (endDate) createdAt.lte = endDate;
  return Object.keys(createdAt).length > 0 ? { createdAt } : {};
};

/**
 * The queue items a reviewer is responsible for: assigned to them directly, or
 * sitting in a queue they belong to. Same reach as the pending and assigned
 * counts, so what the queue page walks and what it hands to a dataset agree.
 */
const callerQueueItemsFilter = ({
  projectId,
  organizationId,
  userId,
}: {
  projectId: string;
  organizationId: string;
  userId: string;
}) => {
  const reference = queueItemReferenceFilter({ projectId, organizationId });
  return {
    ...reference,
    AND: [
      ...reference.AND,
      {
        OR: [
          { userId },
          {
            annotationQueue: {
              projectId,
              members: { some: { userId } },
            },
          },
        ],
      },
    ],
  };
};

/**
 * Only what the member list renders: the avatar and its tooltip.
 *
 * `include: { user: true }` selected every User column — `email`,
 * `emailVerified`, `pendingSsoSetup`, `twoFactorEnabled`, `lastLoginAt`,
 * `deactivatedAt`, `lastHomePath` and the per-user `userHashKey` that
 * ADR-101 §4 mints for identity event hashing — and `getQueueBySlugOrId`
 * returns this row unmodified with no output schema, so all of it reached
 * the browser for every member of every queue a viewer could open.
 *
 * The sibling `getByTraceIds` read was corrected the same way, and its note
 * says the same thing; this one was missed. The two screens that read a
 * member use `id`, `name` and `image`.
 */
const queueMemberInclude = (organizationId: string) => ({
  where: {
    user: {
      orgMemberships: { some: { organizationId } },
    },
  },
  select: {
    user: { select: { id: true, name: true, image: true } },
  },
});

/**
 * A person on an item, as the item lists render them: an avatar and a name.
 * Same reason as {@link queueMemberInclude} — a bare `user: true` publishes
 * every User column to the browser.
 */
const reviewerSelect = { select: { id: true, name: true, image: true } };

/** Only the score's identity and its label, which is all the picker shows. */
const queueScoreInclude = (projectId: string) => ({
  where: { annotationScore: { projectId } },
  select: {
    annotationScore: { select: { id: true, name: true } },
  },
});

/**
 * The store for one request's Prisma client.
 *
 * The return type is deliberately INFERRED, never annotated as
 * {@link AnnotationQueueStore}: the port declares `unknown` wherever the
 * transport only hands a row straight back to the caller, so annotating it
 * would narrow every queue row the client receives to `unknown`. The
 * `satisfies` check at the end is what proves the port is answered in full
 * without erasing the concrete row types.
 */
export function createPrismaAnnotationQueueStore(prisma: PrismaClient) {
  const store = {
    async queueSlugExists({ projectId, slug }: { projectId: string; slug: string }) {
      const existing = await prisma.annotationQueue.findFirst({
        where: { slug, projectId },
      });
      return existing !== null;
    },

    createQueue({
      projectId,
      name,
      slug,
      description,
      userIds,
      scoreTypeIds,
    }: {
      projectId: string;
      name: string;
      slug: string;
      description: string;
      userIds: readonly string[];
      scoreTypeIds: readonly string[];
    }) {
      return prisma.annotationQueue.create({
        data: {
          projectId,
          name,
          slug,
          description,
          members: { create: userIds.map((userId) => ({ userId })) },
          AnnotationQueueScores: {
            create: scoreTypeIds.map((scoreTypeId) => ({
              annotationScoreId: scoreTypeId,
            })),
          },
        },
      });
    },

    updateQueue({
      projectId,
      queueId,
      name,
      slug,
      description,
      userIds,
      scoreTypeIds,
    }: {
      projectId: string;
      queueId: string;
      name: string;
      slug: string;
      description: string;
      userIds: readonly string[];
      scoreTypeIds: readonly string[];
    }) {
      return prisma.annotationQueue.update({
        data: {
          projectId,
          name,
          slug,
          description,
          members: {
            deleteMany: {},
            create: userIds.map((userId) => ({ userId })),
          },
          AnnotationQueueScores: {
            deleteMany: {},
            create: scoreTypeIds.map((scoreTypeId) => ({
              annotationScoreId: scoreTypeId,
            })),
          },
        },
        where: { id: queueId, projectId },
      });
    },

    listQueues({ projectId }: { projectId: string }) {
      return prisma.annotationQueue.findMany({
        where: { projectId },
        select: {
          id: true,
          name: true,
          // The slug is what `/annotations/<slug>` addresses, so anything that
          // links straight to a queue it just wrote to needs it here.
          slug: true,
        },
        orderBy: { createdAt: "desc" },
      });
    },

    findQueue({
      projectId,
      organizationId,
      slug,
      queueId,
    }: {
      projectId: string;
      organizationId: string;
      slug?: string;
      queueId?: string;
    }) {
      return prisma.annotationQueue.findUnique({
        where: queueId
          ? { id: queueId, projectId }
          : { projectId_slug: { projectId, slug: slug! } },
        include: {
          members: queueMemberInclude(organizationId),
          AnnotationQueueScores: queueScoreInclude(projectId),
        },
      });
    },

    listQueueItems({ projectId, organizationId }: { projectId: string; organizationId: string }) {
      return prisma.annotationQueueItem.findMany({
        where: queueItemReferenceFilter({ projectId, organizationId }),
        include: {
          user: reviewerSelect,
          createdByUser: reviewerSelect,
          annotationQueue: {
            include: {
              members: {
                where: {
                  user: { orgMemberships: { some: { organizationId } } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });
    },

    countPendingItems({ projectId, userId }: { projectId: string; userId: string }) {
      return prisma.annotationQueueItem.count({
        where: {
          projectId,
          doneAt: null,
          OR: [
            { userId },
            {
              annotationQueue: {
                projectId,
                members: { some: { userId } },
              },
            },
          ],
        },
      });
    },

    countAssignedItems({ projectId, userId }: { projectId: string; userId: string }) {
      return prisma.annotationQueueItem.count({
        where: { projectId, doneAt: null, userId },
      });
    },

    async listMemberQueuePendingCounts({
      projectId,
      userId,
    }: {
      projectId: string;
      userId: string;
    }) {
      const memberQueues = await prisma.annotationQueue.findMany({
        where: { projectId, members: { some: { userId } } },
        select: { id: true, name: true, slug: true },
      });

      const queueIds = memberQueues.map((queue) => queue.id);
      if (queueIds.length === 0) return [];

      // One grouped count rather than one query per queue.
      const queueCounts = await prisma.annotationQueueItem.groupBy({
        by: ["annotationQueueId"],
        where: {
          projectId,
          annotationQueueId: { in: queueIds },
          doneAt: null,
        },
        _count: { annotationQueueId: true },
      });

      const countMap = new Map(
        queueCounts.map((item) => [item.annotationQueueId, item._count.annotationQueueId]),
      );

      return memberQueues.map((queue) => ({
        id: queue.id,
        name: queue.name,
        slug: queue.slug,
        pendingCount: countMap.get(queue.id) ?? 0,
      }));
    },

    async deleteQueueItems({
      projectId,
      organizationId,
      userId,
      queueItemIds,
    }: {
      projectId: string;
      organizationId: string;
      userId: string;
      queueItemIds: readonly string[];
    }) {
      const result = await prisma.annotationQueueItem.deleteMany({
        where: {
          ...callerQueueItemsFilter({ projectId, organizationId, userId }),
          id: { in: [...queueItemIds] },
        },
      });
      return result.count;
    },

    async markQueueItemDone({
      projectId,
      organizationId,
      userId,
      queueItemId,
    }: {
      projectId: string;
      organizationId: string;
      userId: string;
      queueItemId: string;
    }) {
      const result = await prisma.annotationQueueItem.updateMany({
        where: {
          ...callerQueueItemsFilter({ projectId, organizationId, userId }),
          id: queueItemId,
        },
        data: { doneAt: new Date() },
      });
      if (result.count === 0) return { matched: false as const, item: null };

      return {
        matched: true as const,
        item: await prisma.annotationQueueItem.findFirstOrThrow({
          where: { id: queueItemId, projectId },
        }),
      };
    },

    async listQueueItemsPage({
      projectId,
      organizationId,
      userId,
      status,
      queueId,
      includeMemberQueues,
      startDate,
      endDate,
      pageSize,
      pageOffset,
      allQueueItems,
    }: {
      projectId: string;
      organizationId: string;
      userId: string;
      status: "pending" | "completed" | "all";
      queueId?: string;
      includeMemberQueues: boolean;
      startDate?: Date;
      endDate?: Date;
      pageSize: number;
      pageOffset: number;
      allQueueItems: boolean;
    }) {
      // A queue was named, so which queues the caller belongs to changes
      // nothing about what the page shows.
      const userQueueIds = includeMemberQueues
        ? (
            await prisma.annotationQueue.findMany({
              where: { projectId, members: { some: { userId } } },
            })
          ).map((queue) => queue.id)
        : [];

      const reference = queueItemReferenceFilter({ projectId, organizationId });
      const scope = queueId
        ? // Pin the requested queue to the caller's project so a queue id from
          // another tenant cannot surface its items here.
          { AND: [...reference.AND, { annotationQueue: { id: queueId, projectId } }] }
        : userQueueIds.length > 0
          ? // No specific queue requested: include items from the queues the
            // caller belongs to, plus items assigned directly to them.
            {
              AND: [
                ...reference.AND,
                { OR: [{ annotationQueueId: { in: userQueueIds } }, { userId }] },
              ],
            }
          : // Default case - just user's items
            { AND: reference.AND, userId };

      const whereCondition = {
        ...reference,
        doneAt: status === "pending" ? null : status === "completed" ? { not: null } : void 0,
        ...queuedAtRangeFilter({ startDate, endDate }),
        ...scope,
      };

      const totalCount = await prisma.annotationQueueItem.count({
        where: whereCondition,
      });

      const items = await prisma.annotationQueueItem.findMany({
        where: whereCondition,
        take: allQueueItems ? void 0 : pageSize,
        skip: allQueueItems ? void 0 : pageOffset,
        include: {
          user: reviewerSelect,
          createdByUser: reviewerSelect,
          annotationQueue: {
            include: {
              members: queueMemberInclude(organizationId),
              AnnotationQueueScores: queueScoreInclude(projectId),
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return { totalCount, items };
    },

    listQueuesWithItems({
      projectId,
      organizationId,
      queueIds,
    }: {
      projectId: string;
      organizationId: string;
      queueIds: readonly string[];
    }) {
      return prisma.annotationQueue.findMany({
        where: { id: { in: [...queueIds] }, projectId },
        include: {
          members: queueMemberInclude(organizationId),
          AnnotationQueueScores: queueScoreInclude(projectId),
          AnnotationQueueItems: {
            where: {
              projectId,
              OR: [{ userId: null }, { user: { orgMemberships: { some: { organizationId } } } }],
            },
            include: { user: reviewerSelect, annotationQueue: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });
    },
  };

  // Compile-time proof that this repository answers the whole port the
  // feature transport asks for.
  store satisfies AnnotationQueueStore;
  return store;
}
