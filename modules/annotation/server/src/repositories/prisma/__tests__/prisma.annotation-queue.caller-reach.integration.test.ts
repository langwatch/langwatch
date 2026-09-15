/**
 * @vitest-environment node
 * @see modules/annotation/specs/annotation-queue-workflow.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTestRows } from "@langwatch/test-harness";
import { AnnotationQueueItemNotFoundError } from "@langwatch/annotation-contract";
import { fromDate } from "@langwatch/time";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { PrismaAnnotationQueueItemRepository } from "../prisma.annotation-queue-item.repository.ts";

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
const reviewerQueueId = `test-queue-reviewer-${namespace}`;
const otherProjectId = `test-project-annotation-reach-other-${namespace}`;

const ownItemId = `test-item-own-${namespace}`;
const teammateItemId = `test-item-teammate-${namespace}`;
const unrelatedQueueItemId = `test-item-unrelated-queue-${namespace}`;
const directPendingItemId = `test-item-direct-pending-${namespace}`;
const directCompletedItemId = `test-item-direct-completed-${namespace}`;
const reviewerQueuePendingItemId = `test-item-reviewer-queue-pending-${namespace}`;
const reviewerQueueCompletedItemId = `test-item-reviewer-queue-completed-${namespace}`;
const otherProjectItemId = `test-item-other-project-${namespace}`;

const firstQueuedAt = new Date("2026-01-01T00:00:00.000Z");
const secondQueuedAt = new Date("2026-01-02T00:00:00.000Z");
const thirdQueuedAt = new Date("2026-01-03T00:00:00.000Z");
const fourthQueuedAt = new Date("2026-01-04T00:00:00.000Z");
const firstQueuedAtInstant = fromDate(firstQueuedAt);
const secondQueuedAtInstant = fromDate(secondQueuedAt);
const thirdQueuedAtInstant = fromDate(thirdQueuedAt);
const fourthQueuedAtInstant = fromDate(fourthQueuedAt);

// Finishing or removing an item is scoped to the items the caller is
// responsible for: assigned to them, or in a queue they belong to.
describe.skipIf(!databaseUrl)("queue mutations and the caller's reach", () => {
  const queues = PrismaAnnotationQueueItemRepository.create({ prisma });

  const caller = {
    projectId,
    organizationId,
    organizationMemberIds: [reviewerId, teammateId],
    userId: reviewerId,
  };

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

    await prisma.annotationQueue.create({
      data: {
        id: reviewerQueueId,
        projectId,
        name: reviewerQueueId,
        slug: reviewerQueueId,
        members: { create: [{ userId: reviewerId }] },
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
        {
          id: directPendingItemId,
          projectId,
          traceId: `test-trace-direct-pending-${namespace}`,
          userId: reviewerId,
          createdAt: firstQueuedAt,
        },
        {
          id: directCompletedItemId,
          projectId,
          traceId: `test-trace-direct-completed-${namespace}`,
          userId: reviewerId,
          createdAt: secondQueuedAt,
          doneAt: secondQueuedAt,
        },
        {
          id: reviewerQueuePendingItemId,
          projectId,
          traceId: `test-trace-reviewer-queue-pending-${namespace}`,
          annotationQueueId: reviewerQueueId,
          createdAt: thirdQueuedAt,
        },
        {
          id: reviewerQueueCompletedItemId,
          projectId,
          traceId: `test-trace-reviewer-queue-completed-${namespace}`,
          annotationQueueId: reviewerQueueId,
          createdAt: fourthQueuedAt,
          doneAt: fourthQueuedAt,
        },
        {
          id: otherProjectItemId,
          projectId: otherProjectId,
          traceId: `test-trace-other-project-${namespace}`,
          userId: reviewerId,
          createdAt: fourthQueuedAt,
        },
      ],
    });
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["annotationQueueItem", { projectId }],
      [
        "annotationQueueMembers",
        { annotationQueueId: { in: [unrelatedQueueId, reviewerQueueId] } },
      ],
      ["annotationQueue", { projectId }],
      ["organizationUser", { organizationId }],
    ]);

    await prisma.annotationQueueItem.deleteMany({ where: { projectId: otherProjectId } });
    await prisma.user.deleteMany({ where: { id: { in: [reviewerId, teammateId] } } });
  });

  describe("given an item assigned to a teammate and an item in a queue the reviewer does not belong to", () => {
    /** @scenario "Queue mutations are limited to the reviewer's reachable items" */
    it("leaves both unfinished when the reviewer marks them done", async () => {
      for (const queueItemId of [teammateItemId, unrelatedQueueItemId]) {
        await expect(queues.markQueueItemDone({ ...caller, queueItemId })).rejects.toBeInstanceOf(
          AnnotationQueueItemNotFoundError,
        );
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
      expect(marked).toMatchObject({ id: ownItemId, doneAt: expect.any(Date) });

      expect(await queues.deleteQueueItems({ ...caller, queueItemIds: [ownItemId] })).toBe(1);
    });
  });

  describe("given direct and member-queue assignments with distinct states and dates", () => {
    const page = {
      projectId,
      organizationId,
      organizationMemberIds: [reviewerId, teammateId],
      status: "all" as const,
      startDate: firstQueuedAtInstant,
      endDate: fourthQueuedAtInstant,
      pageSize: 20,
      pageOffset: 0,
      allQueueItems: false,
    };

    it("keeps direct assignments separate until member queues are requested", async () => {
      const direct = await queues.listQueueItemsByUser({
        ...page,
        userId: reviewerId,
        includeMemberQueues: false,
      });

      const reachable = await queues.listQueueItemsByUser({
        ...page,
        userId: reviewerId,
        includeMemberQueues: true,
      });

      expect(direct.items.map((item) => item.id).sort()).toEqual([
        directCompletedItemId,
        directPendingItemId,
      ]);

      expect(reachable.items.map((item) => item.id).sort()).toEqual([
        directCompletedItemId,
        directPendingItemId,
        reviewerQueueCompletedItemId,
        reviewerQueuePendingItemId,
      ]);
    });

    it("applies status, dates, picked queues, and paging to the same reachable set", async () => {
      const pending = await queues.listQueueItemsByUser({
        ...page,
        userId: reviewerId,
        includeMemberQueues: true,
        status: "pending",
      });

      const completed = await queues.listQueueItemsByUser({
        ...page,
        userId: reviewerId,
        includeMemberQueues: true,
        status: "completed",
      });

      const picked = await queues.listQueueItemsByUser({
        ...page,
        userId: reviewerId,
        includeMemberQueues: true,
        pickedQueueIds: [reviewerQueueId],
      });

      const dated = await queues.listQueueItemsByUser({
        ...page,
        userId: reviewerId,
        includeMemberQueues: true,
        startDate: secondQueuedAtInstant,
        endDate: thirdQueuedAtInstant,
      });

      const sliced = await queues.listQueueItemsByUser({
        ...page,
        userId: reviewerId,
        includeMemberQueues: true,
        pageSize: 1,
        pageOffset: 1,
      });

      const exported = await queues.listQueueItemsByUser({
        ...page,
        userId: reviewerId,
        includeMemberQueues: true,
        pageSize: 1,
        pageOffset: 1,
        allQueueItems: true,
      });

      expect(pending.items.map((item) => item.id).sort()).toEqual([
        directPendingItemId,
        reviewerQueuePendingItemId,
      ]);

      expect(completed.items.map((item) => item.id).sort()).toEqual([
        directCompletedItemId,
        reviewerQueueCompletedItemId,
      ]);

      expect(picked.items.map((item) => item.id).sort()).toEqual([
        reviewerQueueCompletedItemId,
        reviewerQueuePendingItemId,
      ]);

      expect(dated.items.map((item) => item.id).sort()).toEqual([
        directCompletedItemId,
        reviewerQueuePendingItemId,
      ]);

      expect(sliced.totalCount).toBe(4);
      expect(sliced.items.map((item) => item.id)).toEqual([reviewerQueuePendingItemId]);
      expect(exported.totalCount).toBe(4);

      expect(exported.items.map((item) => item.id)).toEqual([
        reviewerQueueCompletedItemId,
        reviewerQueuePendingItemId,
        directCompletedItemId,
        directPendingItemId,
      ]);
    });

    it("reads an explicit queue without using actor reach and keeps project rows out", async () => {
      const { startDate: _startDate, endDate: _endDate, ...unboundedPage } = page;

      const unrelated = await queues.listQueueItemsByQueue({
        ...unboundedPage,
        queueId: unrelatedQueueId,
      });

      const reviewerScope = await queues.listQueueItemsByUser({
        ...page,
        userId: reviewerId,
        includeMemberQueues: true,
      });

      expect(unrelated.items.map((item) => item.id)).toEqual([unrelatedQueueItemId]);
      expect(reviewerScope.items.map((item) => item.id)).not.toContain(otherProjectItemId);
    });
  });
});
