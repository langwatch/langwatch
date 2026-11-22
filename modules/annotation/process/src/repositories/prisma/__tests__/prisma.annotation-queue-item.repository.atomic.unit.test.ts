/**
 * Queue-item writes land in one database transaction.
 * See modules/annotation/specs/annotation-service.feature.
 */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaAnnotationQueueItemRepository } from "../prisma.annotation-queue-item.repository.ts";

function harness() {
  const outside = { createMany: vi.fn(), updateMany: vi.fn() };
  const inside = {
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  const $transaction = vi.fn(async (run: (transaction: never) => Promise<unknown>) =>
    run({ annotationQueueItem: inside } as never),
  );

  const repository = PrismaAnnotationQueueItemRepository.create({
    prisma: prismaDouble({ annotationQueueItem: outside, $transaction }),
  });

  return { repository, outside, inside, $transaction };
}

describe("PrismaAnnotationQueueItemRepository.createQueueItems", () => {
  describe("given a queue command with traces, queues and users", () => {
    /** @scenario "queue-item writes are atomic" */
    it("upserts the queue rows and the user rows inside one transaction", async () => {
      const { repository, outside, inside, $transaction } = harness();

      await repository.createQueueItems({
        projectId: "project-1",
        traceIds: ["trace-1", "trace-2"],
        queueIds: ["queue-1"],
        userIds: ["user-1"],
        createdByUserId: "creator-1",
      });

      expect($transaction).toHaveBeenCalledTimes(1);
      expect(inside.createMany).toHaveBeenCalledTimes(2);
      expect(inside.updateMany).toHaveBeenCalledTimes(2);
      expect(outside.createMany).not.toHaveBeenCalled();
      expect(outside.updateMany).not.toHaveBeenCalled();
    });

    /** @scenario "queue-item writes are atomic" */
    it("keeps the unique key and reopens an item that was done when it is queued again", async () => {
      const { repository, inside } = harness();

      await repository.createQueueItems({
        projectId: "project-1",
        traceIds: ["trace-1"],
        queueIds: ["queue-1"],
        userIds: [],
        createdByUserId: "creator-1",
      });

      expect(inside.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true }),
      );
      expect(inside.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ annotationQueueId: { in: ["queue-1"] } }),
          data: { doneAt: null },
        }),
      );
    });
  });
});
