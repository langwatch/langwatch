import {
  AnnotationQueueItemNotFoundError,
  AnnotationQueueNotFoundError,
} from "@langwatch/annotation-contract";
import { describe, expect, it } from "vitest";
import { MemoryAnnotationQueueItemRepository } from "../memory.annotation-queue-item.repository.ts";
import { MemoryAnnotationQueueDatabase } from "../memory.annotation-queue.database.ts";
import { MemoryAnnotationQueueRepository } from "../memory.annotation-queue.repository.ts";

describe("memory annotation queue repositories", () => {
  it("shares queue and item state with caller and tenant isolation", async () => {
    const database = MemoryAnnotationQueueDatabase.create();
    const queues = MemoryAnnotationQueueRepository.create({ database });
    const items = MemoryAnnotationQueueItemRepository.create({ memory: database });

    const queue = await queues.createQueue({
      projectId: "project-1",
      name: "Review",
      slug: "review",
      description: "Review queue",
      userIds: ["user-1"],
      scoreTypeIds: ["score-1"],
    });

    await items.createQueueItems({
      projectId: "project-1",
      traceIds: ["trace-1"],
      queueIds: [queue.id],
      userIds: ["user-2"],
      createdByUserId: "user-1",
    });

    expect(await items.countPendingItems({ projectId: "project-1", userId: "user-1" })).toBe(1);
    expect(await items.countAssignedItems({ projectId: "project-1", userId: "user-2" })).toBe(1);

    expect(
      await queues.listQueues({ projectId: "project-1", reachableOnly: true, userId: "user-1" }),
    ).toHaveLength(1);

    await expect(
      queues.getQueueById({
        projectId: "project-1",
        organizationId: "org-1",
        organizationMemberIds: ["user-1"],
        queueId: queue.id,
      }),
    ).resolves.toMatchObject({ id: queue.id, members: [{ user: { id: "user-1" } }] });

    await expect(
      queues.getQueueBySlug({
        projectId: "project-2",
        organizationId: "org-1",
        organizationMemberIds: ["user-1"],
        slug: queue.slug,
      }),
    ).rejects.toBeInstanceOf(AnnotationQueueNotFoundError);

    await expect(
      queues.updateQueue({
        projectId: "project-2",
        queueId: queue.id,
        name: "Review",
        slug: "review",
        description: "Review queue",
        userIds: ["user-1"],
        scoreTypeIds: ["score-1"],
      }),
    ).rejects.toBeInstanceOf(AnnotationQueueNotFoundError);

    expect(
      await items.listQueueItems({
        projectId: "project-1",
        organizationId: "org-1",
        organizationMemberIds: ["user-1"],
      }),
    ).toHaveLength(1);

    expect(
      await items.listQueueItems({
        projectId: "project-2",
        organizationId: "org-1",
        organizationMemberIds: ["user-1"],
      }),
    ).toEqual([]);

    await expect(
      items.listQueuesWithItems({
        projectId: "project-1",
        organizationId: "org-1",
        organizationMemberIds: [],
        queueIds: [queue.id],
      }),
    ).resolves.toMatchObject([{ id: queue.id, members: [] }]);

    const page = await items.listQueueItemsByUser({
      projectId: "project-1",
      organizationId: "org-1",
      organizationMemberIds: ["user-1"],
      userId: "user-1",
      status: "pending",
      includeMemberQueues: true,
      pageSize: 10,
      pageOffset: 0,
      allQueueItems: false,
    });

    expect(page.totalCount).toBe(1);

    const itemId = page.items[0]?.id;
    expect(itemId).toBeDefined();

    const done = await items.markQueueItemDone({
      projectId: "project-1",
      organizationId: "org-1",
      organizationMemberIds: ["user-1"],
      userId: "user-1",
      queueItemId: itemId!,
    });

    expect(done).toMatchObject({ id: itemId, doneAt: expect.any(Date) });
    const assignedItemId = database.items().find((item) => item.userId === "user-2")?.id;
    if (assignedItemId === void 0) throw new Error("assigned item was not created");

    await expect(
      items.markQueueItemDone({
        projectId: "project-1",
        organizationId: "org-1",
        organizationMemberIds: [],
        userId: "user-1",
        queueItemId: assignedItemId,
      }),
    ).rejects.toBeInstanceOf(AnnotationQueueItemNotFoundError);

    await items.createQueueItems({
      projectId: "project-1",
      traceIds: ["trace-1"],
      queueIds: [queue.id],
      userIds: [],
      createdByUserId: "user-1",
    });

    expect(await items.countPendingItems({ projectId: "project-1", userId: "user-1" })).toBe(1);
  });
});
