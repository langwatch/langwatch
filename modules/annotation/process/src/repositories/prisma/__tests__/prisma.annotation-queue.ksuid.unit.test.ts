import { parse } from "@langwatch/ksuid";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaAnnotationQueueItemRepository } from "../prisma.annotation-queue-item.repository.ts";
import { PrismaAnnotationQueueRepository } from "../prisma.annotation-queue.repository.ts";

function resourceOf(id: unknown): string {
  return parse(String(id)).resource;
}

describe("Postgres annotation queues", () => {
  describe("when a queue is created", () => {
    /** @scenario "queues and queue items are stored under strict KSUIDs" */
    it("mints the queue id as an annotationqueue KSUID", async () => {
      const create = vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve(data));
      const repository = PrismaAnnotationQueueRepository.create({
        prisma: prismaDouble({ annotationQueue: { create } }),
      });

      await repository.createQueue({
        projectId: "project-1",
        name: "Reviews",
        slug: "reviews",
        description: "",
        userIds: [],
        scoreTypeIds: [],
      });

      expect(resourceOf(create.mock.calls[0]![0].data.id)).toBe("annotationqueue");
    });
  });

  describe("when traces are queued for a queue and a user", () => {
    /** @scenario "queues and queue items are stored under strict KSUIDs" */
    it("mints a distinct annotationqueueitem KSUID for every row", async () => {
      const createMany = vi
        .fn<(args: { data: { id?: string }[] }) => Promise<{ count: number }>>()
        .mockResolvedValue({ count: 0 });
      const updateMany = vi.fn().mockResolvedValue({ count: 0 });
      const $transaction = vi.fn(async (run: (transaction: never) => Promise<unknown>) =>
        run({ annotationQueueItem: { createMany, updateMany } } as never),
      );
      const repository = PrismaAnnotationQueueItemRepository.create({
        prisma: prismaDouble({ $transaction }),
      });

      await repository.createQueueItems({
        projectId: "project-1",
        traceIds: ["trace-1", "trace-2"],
        queueIds: ["queue-1"],
        userIds: ["user-1"],
        createdByUserId: "creator-1",
      });

      const ids = createMany.mock.calls.flatMap(([{ data }]) => data.map((row) => row.id));
      expect(ids).toHaveLength(4);
      expect(new Set(ids).size).toBe(4);
      expect(ids.map(resourceOf)).toEqual(Array(4).fill("annotationqueueitem"));
    });
  });
});
