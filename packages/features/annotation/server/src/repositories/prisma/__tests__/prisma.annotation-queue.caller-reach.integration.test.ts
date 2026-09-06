/**
 * @vitest-environment node
 * @see packages/features/annotation/specs/annotation-queue-workflow.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestRows } from "@langwatch/test-harness";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { PrismaAnnotationQueueRepository } from "../prisma.annotation-queue.repository.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const namespace = nanoid();
const projectId = `test-project-annotation-reach-${namespace}`;
const organizationId = `test-organization-annotation-reach-${namespace}`;
const reviewerId = `test-user-reviewer-${namespace}`;
const teammateId = `test-user-teammate-${namespace}`;
const unrelatedQueueId = `test-queue-unrelated-${namespace}`;

const ownItemId = `test-item-own-${namespace}`;
const teammateItemId = `test-item-teammate-${namespace}`;
const unrelatedQueueItemId = `test-item-unrelated-queue-${namespace}`;

// Finishing or removing an item is scoped to the items the caller is
// responsible for: assigned to them, or in a queue they belong to.
describe.skipIf(!databaseUrl)("queue mutations and the caller's reach", () => {
  const queues = PrismaAnnotationQueueRepository.create(prisma);

  const caller = { projectId, organizationId, userId: reviewerId };

  beforeAll(async () => {
    for (const userId of [reviewerId, teammateId]) {
      await prisma.user.create({ data: { id: userId } });
      await prisma.organizationUser.create({
        data: { userId, organizationId, role: "MEMBER" },
      });
    }
    // A queue the reviewer is not a member of: the teammate is.
    await prisma.annotationQueue.create({
      data: {
        id: unrelatedQueueId,
        projectId,
        name: unrelatedQueueId,
        slug: unrelatedQueueId,
        members: { create: [{ userId: teammateId }] },
      },
    });
    await prisma.annotationQueueItem.createMany({
      data: [
        {
          id: ownItemId,
          projectId,
          traceId: `test-trace-own-${namespace}`,
          userId: reviewerId,
        },
        {
          id: teammateItemId,
          projectId,
          traceId: `test-trace-teammate-${namespace}`,
          userId: teammateId,
        },
        {
          id: unrelatedQueueItemId,
          projectId,
          traceId: `test-trace-unrelated-${namespace}`,
          annotationQueueId: unrelatedQueueId,
        },
      ],
    });
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["annotationQueueItem", { projectId }],
      ["annotationQueueMembers", { annotationQueueId: unrelatedQueueId }],
      ["annotationQueue", { projectId }],
      ["organizationUser", { organizationId }],
    ]);
    await prisma.user.deleteMany({ where: { id: { in: [reviewerId, teammateId] } } });
  });

  describe("given an item assigned to a teammate and an item in a queue the reviewer does not belong to", () => {
    /** @scenario "Queue mutations are limited to the reviewer's reachable items" */
    it("leaves both unfinished when the reviewer marks them done", async () => {
      for (const queueItemId of [teammateItemId, unrelatedQueueItemId]) {
        const marked = await queues.markQueueItemDone({ ...caller, queueItemId });

        expect(marked).toEqual({ matched: false, item: null });
      }

      const rows = await prisma.annotationQueueItem.findMany({
        where: { id: { in: [teammateItemId, unrelatedQueueItemId] } },
        select: { id: true, doneAt: true },
      });
      expect(rows.map((row) => row.doneAt)).toEqual([null, null]);
    });

    /** @scenario "Queue mutations are limited to the reviewer's reachable items" */
    it("removes neither when the reviewer clears them from the queue", async () => {
      const deleted = await queues.deleteQueueItems({
        ...caller,
        queueItemIds: [teammateItemId, unrelatedQueueItemId],
      });

      expect(deleted).toBe(0);
      expect(
        await prisma.annotationQueueItem.count({
          where: { id: { in: [teammateItemId, unrelatedQueueItemId] } },
        }),
      ).toBe(2);
    });
  });

  describe("given an item assigned to the reviewer", () => {
    it("finishes and then removes it, which is what the refusals above are measured against", async () => {
      const marked = await queues.markQueueItemDone({ ...caller, queueItemId: ownItemId });
      expect(marked.matched).toBe(true);

      expect(await queues.deleteQueueItems({ ...caller, queueItemIds: [ownItemId] })).toBe(1);
    });
  });
});
