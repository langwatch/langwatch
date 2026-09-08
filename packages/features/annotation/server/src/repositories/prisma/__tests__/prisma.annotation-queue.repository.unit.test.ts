import { describe, expect, it, vi } from "vitest";
import type { AnnotationQueueItemDatabase } from "../prisma.annotation-queue-item.repository.ts";
import { PrismaAnnotationQueueItemRepository } from "../prisma.annotation-queue-item.repository.ts";

const createdAt = new Date("2026-01-01T00:00:00.000Z");
const updatedAt = new Date("2026-01-02T00:00:00.000Z");
const doneAt = new Date("2026-01-03T00:00:00.000Z");
const markedForDatasetAt = new Date("2026-01-04T00:00:00.000Z");

const record = {
  id: "queue-1",
  name: "Reviews",
  slug: "reviews",
  projectId: "project-1",
  description: "Human review",
  createdAt,
  updatedAt,
};
const member = { user: { id: "user-1", name: "Reviewer", image: null } };
const score = { annotationScore: { id: "score-1", name: "Correctness" } };
const item = {
  id: "item-1",
  annotationQueueId: "queue-1",
  userId: "user-1",
  createdByUserId: "creator-1",
  traceId: "trace-1",
  projectId: "project-1",
  createdAt,
  updatedAt,
  doneAt: null,
  markedForDatasetAt,
};

function delegates() {
  const queue = {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
  };

  const queueItem = {
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
    findFirst: vi.fn(),
    deleteMany: vi.fn(),
    groupBy: vi.fn(),
  };

  return {
    prisma: {
      annotationQueue: queue,
      annotationQueueItem: queueItem,
    } as unknown as AnnotationQueueItemDatabase,
    queue,
    queueItem,
  };
}

describe("PrismaAnnotationQueueItemRepository response projections", () => {
  it("preserves complete listed items, including assignment and dataset dates", async () => {
    const { prisma, queueItem } = delegates();

    const row = {
      ...item,
      user: { id: "user-1", name: "Reviewer", image: null },
      createdByUser: null,
      annotationQueue: { ...record, members: [{ annotationQueueId: "queue-1", userId: "user-1" }] },
    };

    queueItem.findMany.mockResolvedValue([row]);

    const result = await PrismaAnnotationQueueItemRepository.create({ prisma }).listQueueItems({
      projectId: "project-1",
      organizationId: "org-1",
      organizationMemberIds: ["user-1"],
    });

    expect(result).toEqual([row]);

    expect(queueItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ projectId: "project-1" }) }),
    );
  });

  it("preserves page item relations and applies caller, status, and pagination", async () => {
    const { prisma, queue, queueItem } = delegates();

    const row = {
      ...item,
      user: { id: "user-1", name: "Reviewer", image: null },
      createdByUser: null,
      annotationQueue: { ...record, members: [member], AnnotationQueueScores: [score] },
    };

    queue.findMany.mockResolvedValue([]);
    queueItem.count.mockResolvedValue(1);
    queueItem.findMany.mockResolvedValue([row]);

    const input = {
      projectId: "project-1",
      organizationId: "org-1",
      organizationMemberIds: ["user-1"],
      userId: "user-1",
      status: "pending" as const,
      includeMemberQueues: true,
      pageSize: 25,
      pageOffset: 5,
      allQueueItems: false,
    };

    await expect(
      PrismaAnnotationQueueItemRepository.create({ prisma }).listQueueItemsByUser(input),
    ).resolves.toEqual({ totalCount: 1, items: [row] });

    expect(queueItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 25, skip: 5, orderBy: { createdAt: "desc" } }),
    );
  });

  it("preserves complete queues with members, scores, and nested items", async () => {
    const { prisma, queue } = delegates();

    const row = {
      ...record,
      members: [member],
      AnnotationQueueScores: [score],
      AnnotationQueueItems: [{ ...item, user: member.user, annotationQueue: record }],
    };

    queue.findMany.mockResolvedValue([row]);

    await expect(
      PrismaAnnotationQueueItemRepository.create({ prisma }).listQueuesWithItems({
        projectId: "project-1",
        organizationId: "org-1",
        organizationMemberIds: ["user-1"],
        queueIds: ["queue-1"],
      }),
    ).resolves.toEqual([row]);

    expect(queue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["queue-1"] }, projectId: "project-1" } }),
    );
  });

  it("returns the persisted completion row with its null and date fields", async () => {
    const { prisma, queueItem } = delegates();
    queueItem.updateMany.mockResolvedValue({ count: 1 });
    queueItem.findFirst.mockResolvedValue({ ...item, doneAt });

    await expect(
      PrismaAnnotationQueueItemRepository.create({ prisma }).markQueueItemDone({
        projectId: "project-1",
        organizationId: "org-1",
        organizationMemberIds: ["user-1"],
        userId: "user-1",
        queueItemId: "item-1",
      }),
    ).resolves.toEqual({ ...item, doneAt });

    expect(queueItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ projectId: "project-1", id: "item-1" }),
        data: { doneAt: expect.any(Date) },
      }),
    );
  });
});
