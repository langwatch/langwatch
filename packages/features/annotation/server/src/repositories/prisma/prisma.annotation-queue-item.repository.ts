import {
  AnnotationQueueItemNotFoundError,
  type AnnotationQueueItem,
  type AnnotationQueueListedItem,
  type AnnotationQueuePendingCount,
  type AnnotationQueueWithItems,
} from "@langwatch/annotation-contract";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { PrismaRepository } from "@langwatch/prisma-client";
import { toDate, type Instant } from "@langwatch/time";
import type {
  AnnotationQueueItemCaller,
  AnnotationQueueItemOrganizationScope,
  AnnotationQueueItemRepository,
  AnnotationQueueItemsPage,
  CreateAnnotationQueueItemsInput,
  DeleteAnnotationQueueItemsInput,
  ListQueueItemsPageInput,
  ListQueueItemsByUserInput,
  ListQueueItemsByQueueInput,
  ListAnnotationQueuesWithItemsInput,
  MarkAnnotationQueueItemDoneInput,
} from "../annotation-queue-item.repository.ts";

export type AnnotationQueueItemDatabase = Pick<
  PrismaClient,
  "annotationQueue" | "annotationQueueItem" | "$transaction"
>;

const reviewerSelect = { select: { id: true, name: true, image: true } };

const queueMemberInclude = (organizationId: string) => ({
  where: { user: { orgMemberships: { some: { organizationId } } } },
  select: { user: { select: { id: true, name: true, image: true } } },
});

const queueScoreInclude = (projectId: string) => ({
  where: { annotationScore: { projectId } },
  select: { annotationScore: { select: { id: true, name: true } } },
});

const referenceFilter = ({
  projectId,
  organizationId,
}: {
  projectId: string;
  organizationId: string;
}) => ({
  projectId,
  AND: [
    { OR: [{ annotationQueueId: null }, { annotationQueue: { projectId } }] },
    { OR: [{ userId: null }, { user: { orgMemberships: { some: { organizationId } } } }] },
  ],
});

const callerFilter = ({
  projectId,
  organizationId,
  userId,
}: {
  projectId: string;
  organizationId: string;
  userId: string;
}) => {
  const reference = referenceFilter({ projectId, organizationId });

  return {
    ...reference,
    AND: [
      ...reference.AND,
      { OR: [{ userId }, { annotationQueue: { projectId, members: { some: { userId } } } }] },
    ],
  };
};

const queuedAtRange = ({ startDate, endDate }: { startDate?: Instant; endDate?: Instant }) => {
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (startDate) createdAt.gte = toDate(startDate);

  if (endDate) createdAt.lte = toDate(endDate);

  return Object.keys(createdAt).length > 0 ? { createdAt } : {};
};

export class PrismaAnnotationQueueItemRepository
  extends PrismaRepository.transactionalFor("AnnotationQueue", "AnnotationQueueItem")
  implements AnnotationQueueItemRepository
{
  static readonly create = this.factory(
    (prisma) => new PrismaAnnotationQueueItemRepository(prisma),
  );

  async createQueueItems(input: CreateAnnotationQueueItemsInput): Promise<void> {
    const queueItems = input.traceIds.flatMap((traceId) =>
      input.queueIds.map((annotationQueueId) => ({
        annotationQueueId,
        traceId,
        projectId: input.projectId,
        createdByUserId: input.createdByUserId,
      })),
    );

    const userItems = input.traceIds.flatMap((traceId) =>
      input.userIds.map((userId) => ({
        userId,
        traceId,
        projectId: input.projectId,
        createdByUserId: input.createdByUserId,
      })),
    );

    await this.transaction(async (transaction) => {
      if (queueItems.length > 0) {
        await transaction.annotationQueueItem.createMany({
          data: queueItems,
          skipDuplicates: true,
        });

        await transaction.annotationQueueItem.updateMany({
          where: {
            projectId: input.projectId,
            traceId: { in: [...input.traceIds] },
            annotationQueueId: { in: [...input.queueIds] },
          },
          data: { doneAt: null },
        });
      }

      if (userItems.length > 0) {
        await transaction.annotationQueueItem.createMany({ data: userItems, skipDuplicates: true });

        await transaction.annotationQueueItem.updateMany({
          where: {
            projectId: input.projectId,
            traceId: { in: [...input.traceIds] },
            userId: { in: [...input.userIds] },
          },
          data: { doneAt: null },
        });
      }
    });
  }

  async listQueueItems({
    projectId,
    organizationId,
  }: AnnotationQueueItemOrganizationScope): Promise<AnnotationQueueListedItem[]> {
    const items = await this.prisma.annotationQueueItem.findMany({
      where: referenceFilter({ projectId, organizationId }),
      include: {
        user: reviewerSelect,
        createdByUser: reviewerSelect,
        annotationQueue: {
          include: {
            members: { where: { user: { orgMemberships: { some: { organizationId } } } } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return items;
  }

  countPendingItems({ projectId, userId }: AnnotationQueueItemCaller): Promise<number> {
    return this.prisma.annotationQueueItem.count({
      where: {
        projectId,
        doneAt: null,
        OR: [{ userId }, { annotationQueue: { projectId, members: { some: { userId } } } }],
      },
    });
  }

  countAssignedItems({ projectId, userId }: AnnotationQueueItemCaller): Promise<number> {
    return this.prisma.annotationQueueItem.count({ where: { projectId, doneAt: null, userId } });
  }

  async listMemberQueuePendingCounts({
    projectId,
    userId,
  }: AnnotationQueueItemCaller): Promise<AnnotationQueuePendingCount[]> {
    const queues = await this.prisma.annotationQueue.findMany({
      where: { projectId, members: { some: { userId } } },
      select: { id: true, name: true, slug: true },
    });

    const queueIds = queues.map((queue) => queue.id);
    if (queueIds.length === 0) return [];

    const counts = await this.prisma.annotationQueueItem.groupBy({
      by: ["annotationQueueId"],
      where: { projectId, annotationQueueId: { in: queueIds }, doneAt: null },
      _count: { annotationQueueId: true },
    });

    const countByQueueId = new Map(
      counts.map((item) => [item.annotationQueueId, item._count.annotationQueueId]),
    );

    return queues.map((queue) => ({ ...queue, pendingCount: countByQueueId.get(queue.id) ?? 0 }));
  }

  async deleteQueueItems({
    projectId,
    organizationId,
    userId,
    queueItemIds,
  }: DeleteAnnotationQueueItemsInput): Promise<number> {
    const result = await this.prisma.annotationQueueItem.deleteMany({
      where: {
        ...callerFilter({ projectId, organizationId, userId }),
        id: { in: [...queueItemIds] },
      },
    });

    return result.count;
  }

  async markQueueItemDone({
    projectId,
    organizationId,
    userId,
    queueItemId,
  }: MarkAnnotationQueueItemDoneInput): Promise<AnnotationQueueItem> {
    const result = await this.prisma.annotationQueueItem.updateMany({
      where: { ...callerFilter({ projectId, organizationId, userId }), id: queueItemId },
      data: { doneAt: new Date() },
    });

    if (result.count === 0) throw new AnnotationQueueItemNotFoundError(queueItemId);

    const item = await this.prisma.annotationQueueItem.findFirst({
      where: { id: queueItemId, projectId },
    });

    if (!item) throw new AnnotationQueueItemNotFoundError(queueItemId);

    return item;
  }

  listQueueItemsByUser(input: ListQueueItemsByUserInput): Promise<AnnotationQueueItemsPage> {
    const assignments: Prisma.AnnotationQueueItemWhereInput[] = [{ userId: input.userId }];

    if (input.includeMemberQueues) {
      assignments.push({
        annotationQueue: {
          projectId: input.projectId,
          members: { some: { userId: input.userId } },
        },
      });
    }

    return this.#listPage(input, { OR: assignments });
  }

  listQueueItemsByQueue(input: ListQueueItemsByQueueInput): Promise<AnnotationQueueItemsPage> {
    return this.#listPage(input, {
      annotationQueue: { id: input.queueId, projectId: input.projectId },
    });
  }

  async #listPage(
    input: ListQueueItemsPageInput,
    target: Prisma.AnnotationQueueItemWhereInput,
  ): Promise<AnnotationQueueItemsPage> {
    const where: Prisma.AnnotationQueueItemWhereInput = {
      projectId: input.projectId,
      AND: [referenceFilter(input), target],
      ...queuedAtRange(input),
    };

    if (input.status === "pending") where.doneAt = null;

    if (input.status === "completed") where.doneAt = { not: null };

    if (input.pickedQueueIds?.length) {
      where.annotationQueueId = { in: [...input.pickedQueueIds] };
    }

    const totalCount = await this.prisma.annotationQueueItem.count({ where });

    const items = await this.prisma.annotationQueueItem.findMany({
      where,
      take: input.allQueueItems ? void 0 : input.pageSize,
      skip: input.allQueueItems ? void 0 : input.pageOffset,
      include: {
        user: reviewerSelect,
        createdByUser: reviewerSelect,
        annotationQueue: {
          include: {
            members: queueMemberInclude(input.organizationId),
            AnnotationQueueScores: queueScoreInclude(input.projectId),
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return { totalCount, items };
  }

  async listQueuesWithItems({
    projectId,
    organizationId,
    queueIds,
  }: ListAnnotationQueuesWithItemsInput): Promise<AnnotationQueueWithItems[]> {
    const queues = await this.prisma.annotationQueue.findMany({
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

    return queues;
  }
}
