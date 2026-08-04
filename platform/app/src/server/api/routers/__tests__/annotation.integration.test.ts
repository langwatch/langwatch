/**
 * @vitest-environment node
 *
 * Integration tests for annotation CRUD via the tRPC router with a real database.
 * Annotations persist in Postgres via the service/repository; the router also
 * performs a best-effort ClickHouse sync (stubbed here) that must never block
 * the mutation.
 */
import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { prisma } from "../../../db";
import { TraceEditOverlayService } from "../../../traces/edit-overlay/traceEditOverlay.service";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

const { mockAddAnnotation, mockRemoveAnnotation } = vi.hoisted(() => ({
  mockAddAnnotation: vi.fn().mockResolvedValue(undefined),
  mockRemoveAnnotation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    traces: {
      addAnnotation: mockAddAnnotation,
      removeAnnotation: mockRemoveAnnotation,
      // The correction store is real here: the suggestion dual-write and the
      // trace correction it produces are what these tests assert on.
      editOverlay: TraceEditOverlayService.create(prisma),
    },
  }),
}));

describe("Annotation CRUD", () => {
  const projectId = "test-project-id";
  const traceId = "test-trace-annotation-integration";
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    await prisma.annotation.deleteMany({ where: { projectId } });

    const user = await getTestUser();
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    caller = appRouter.createCaller(ctx);
  });

  afterAll(async () => {
    await prisma.annotation.deleteMany({ where: { projectId } });
    await prisma.traceEditOverlay.deleteMany({ where: { projectId } });
  });

  describe("when creating an annotation", () => {
    it("persists the annotation in Postgres", async () => {
      const result = await caller.annotation.create({
        projectId,
        traceId,
        comment: "happy path",
        isThumbsUp: true,
        scoreOptions: {},
      });

      expect(result.id).toBeDefined();
      expect(result.comment).toBe("happy path");

      const persisted = await prisma.annotation.findFirst({
        where: { id: result.id, projectId },
      });
      expect(persisted).not.toBeNull();
      expect(persisted!.traceId).toBe(traceId);
    });
  });

  describe("when updating an annotation", () => {
    it("updates the annotation via the service layer", async () => {
      const created = await caller.annotation.create({
        projectId,
        traceId,
        comment: "original",
        isThumbsUp: false,
        scoreOptions: {},
      });

      const updated = await caller.annotation.updateByTraceId({
        id: created.id,
        projectId,
        traceId,
        comment: "updated",
        isThumbsUp: true,
        scoreOptions: {},
      });

      expect(updated.id).toBe(created.id);
      expect(updated.comment).toBe("updated");
      expect(updated.isThumbsUp).toBe(true);

      const persisted = await prisma.annotation.findFirst({
        where: { id: created.id, projectId },
      });
      expect(persisted!.comment).toBe("updated");
    });
  });

  describe("when deleting an annotation", () => {
    it("removes the annotation from Postgres", async () => {
      const created = await caller.annotation.create({
        projectId,
        traceId,
        comment: "to be deleted",
        scoreOptions: {},
      });

      const deleted = await caller.annotation.deleteById({
        annotationId: created.id,
        projectId,
      });

      expect(deleted.id).toBe(created.id);

      const persisted = await prisma.annotation.findFirst({
        where: { id: created.id, projectId },
      });
      expect(persisted).toBeNull();
    });
  });

  describe("when the ClickHouse sync fails on create", () => {
    it("still returns and persists the annotation", async () => {
      mockAddAnnotation.mockRejectedValueOnce(
        new Error("ClickHouse unavailable"),
      );

      const result = await caller.annotation.create({
        projectId,
        traceId,
        comment: "survives sync failure",
        isThumbsUp: true,
        scoreOptions: {},
      });

      expect(result.id).toBeDefined();
      expect(result.comment).toBe("survives sync failure");

      const persisted = await prisma.annotation.findFirst({
        where: { id: result.id, projectId },
      });
      expect(persisted).not.toBeNull();
    });
  });

  describe("when the ClickHouse sync fails on delete", () => {
    it("still returns the annotation and removes it from Postgres", async () => {
      const created = await caller.annotation.create({
        projectId,
        traceId,
        comment: "delete despite sync failure",
        scoreOptions: {},
      });

      mockRemoveAnnotation.mockRejectedValueOnce(
        new Error("ClickHouse unavailable"),
      );

      const deleted = await caller.annotation.deleteById({
        annotationId: created.id,
        projectId,
      });

      expect(deleted.id).toBe(created.id);

      const persisted = await prisma.annotation.findFirst({
        where: { id: created.id, projectId },
      });
      expect(persisted).toBeNull();
    });
  });

  describe("given an annotation carrying a suggested output", () => {
    const suggestionTraceId = "test-trace-annotation-suggestion";

    const overlayFor = (forTraceId: string) =>
      prisma.traceEditOverlay.findUnique({
        where: {
          projectId_traceId: { projectId, traceId: forTraceId },
        },
      });

    /** @scenario "Suggesting an output writes the annotation and the correction" */
    it("writes the annotation and records the correction", async () => {
      const created = await caller.annotation.create({
        projectId,
        traceId: suggestionTraceId,
        comment: "the output is wrong",
        expectedOutput: "the right answer",
        scoreOptions: {},
      });

      expect(created.expectedOutput).toBe("the right answer");

      const overlay = await overlayFor(suggestionTraceId);
      expect(overlay).not.toBeNull();
      expect(overlay!.patch).toMatchObject({
        version: 1,
        trace: { output: { value: "the right answer" } },
      });
    });

    /** @scenario "Updating a suggestion keeps the other corrections on the trace" */
    it("keeps the span rename already stored on the trace", async () => {
      const traceWithEdits = "test-trace-annotation-suggestion-merge";
      await prisma.traceEditOverlay.deleteMany({
        where: { projectId, traceId: traceWithEdits },
      });
      await caller.traceEditOverlay.upsert({
        projectId,
        traceId: traceWithEdits,
        patch: {
          version: 1,
          trace: { output: { value: "first answer" } },
          spans: [{ spanId: "span-1", name: "cleaned up" }],
          deletedSpanIds: [],
        },
      });

      const created = await caller.annotation.create({
        projectId,
        traceId: traceWithEdits,
        comment: "still wrong",
        expectedOutput: "first answer",
        scoreOptions: {},
      });

      await caller.annotation.updateByTraceId({
        id: created.id,
        projectId,
        traceId: traceWithEdits,
        comment: "still wrong",
        expectedOutput: "second answer",
        scoreOptions: {},
      });

      const overlay = await overlayFor(traceWithEdits);
      expect(overlay!.patch).toMatchObject({
        trace: { output: { value: "second answer" } },
        spans: [{ spanId: "span-1", name: "cleaned up" }],
      });
    });

    /** @scenario "An annotation without a suggestion never touches the correction" */
    it("leaves the trace uncorrected when there is no suggestion", async () => {
      const commentOnlyTraceId = "test-trace-annotation-comment-only";

      await caller.annotation.create({
        projectId,
        traceId: commentOnlyTraceId,
        comment: "looks fine",
        scoreOptions: {},
      });

      expect(await overlayFor(commentOnlyTraceId)).toBeNull();
    });

    /** @scenario "Deleting the suggestion annotation leaves the correction in place" */
    it("keeps the correction when the suggestion annotation is deleted", async () => {
      const deletableTraceId = "test-trace-annotation-suggestion-deleted";

      const created = await caller.annotation.create({
        projectId,
        traceId: deletableTraceId,
        comment: "wrong output",
        expectedOutput: "the right answer",
        scoreOptions: {},
      });

      await caller.annotation.deleteById({
        annotationId: created.id,
        projectId,
      });

      const overlay = await overlayFor(deletableTraceId);
      expect(overlay).not.toBeNull();

      await caller.traceEditOverlay.delete({
        projectId,
        traceId: deletableTraceId,
      });
      expect(await overlayFor(deletableTraceId)).toBeNull();
    });
  });

  describe("given queue items marked for the dataset hand-off", () => {
    const queueTracePrefix = "test-trace-annotation-queue-mark";
    let viewerCaller: ReturnType<typeof appRouter.createCaller>;
    let ownerUserId: string;

    const createQueueItem = async (suffix: string) => {
      const itemTraceId = `${queueTracePrefix}-${suffix}`;
      await prisma.annotationQueueItem.deleteMany({
        where: { projectId, traceId: itemTraceId },
      });
      return prisma.annotationQueueItem.create({
        data: {
          projectId,
          traceId: itemTraceId,
          userId: ownerUserId,
        },
      });
    };

    beforeAll(async () => {
      const user = await getTestUser();
      ownerUserId = user.id;

      const project = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { teamId: true, team: { select: { organizationId: true } } },
      });
      const readOnly = await prisma.user.upsert({
        where: { email: "annotation-queue-mark-viewer@example.com" },
        update: {},
        create: {
          name: "Queue Read Only",
          email: "annotation-queue-mark-viewer@example.com",
        },
      });
      await prisma.teamUser.upsert({
        where: {
          userId_teamId: { userId: readOnly.id, teamId: project.teamId },
        },
        update: { role: TeamUserRole.VIEWER },
        create: {
          userId: readOnly.id,
          teamId: project.teamId,
          role: TeamUserRole.VIEWER,
        },
      });
      await prisma.organizationUser.upsert({
        where: {
          userId_organizationId: {
            userId: readOnly.id,
            organizationId: project.team.organizationId,
          },
        },
        update: {},
        create: {
          userId: readOnly.id,
          organizationId: project.team.organizationId,
          role: OrganizationUserRole.MEMBER,
        },
      });
      viewerCaller = appRouter.createCaller(
        createInnerTRPCContext({
          session: { user: { id: readOnly.id }, expires: "1" },
        }),
      );
    });

    afterAll(async () => {
      await prisma.annotationQueueItem.deleteMany({
        where: { projectId, traceId: { startsWith: queueTracePrefix } },
      });
    });

    /** @scenario "Marking a queue item for the dataset persists the mark" */
    it("persists the mark on the queue item", async () => {
      const item = await createQueueItem("persist");

      await caller.annotation.markQueueItemForDataset({
        queueItemId: item.id,
        projectId,
        marked: true,
      });

      const persisted = await prisma.annotationQueueItem.findFirst({
        where: { id: item.id, projectId },
      });
      expect(persisted!.markedForDatasetAt).not.toBeNull();
    });

    /** @scenario "Unmarking a queue item clears the mark" */
    it("clears the mark when the annotator unmarks it", async () => {
      const item = await createQueueItem("unmark");

      await caller.annotation.markQueueItemForDataset({
        queueItemId: item.id,
        projectId,
        marked: true,
      });
      await caller.annotation.markQueueItemForDataset({
        queueItemId: item.id,
        projectId,
        marked: false,
      });

      const persisted = await prisma.annotationQueueItem.findFirst({
        where: { id: item.id, projectId },
      });
      expect(persisted!.markedForDatasetAt).toBeNull();
    });

    /** @scenario "Marks are cleared for a batch of queue items at once" */
    it("clears the batch and leaves items outside it marked", async () => {
      const first = await createQueueItem("batch-one");
      const second = await createQueueItem("batch-two");
      const untouched = await createQueueItem("batch-untouched");

      for (const item of [first, second, untouched]) {
        await caller.annotation.markQueueItemForDataset({
          queueItemId: item.id,
          projectId,
          marked: true,
        });
      }

      const result = await caller.annotation.clearDatasetMarks({
        projectId,
        queueItemIds: [first.id, second.id],
      });

      expect(result.cleared).toBe(2);
      const rows = await prisma.annotationQueueItem.findMany({
        where: { projectId, id: { in: [first.id, second.id, untouched.id] } },
      });
      const marked = Object.fromEntries(
        rows.map((row) => [row.id, row.markedForDatasetAt !== null]),
      );
      expect(marked[first.id]).toBe(false);
      expect(marked[second.id]).toBe(false);
      expect(marked[untouched.id]).toBe(true);
    });

    /** @scenario "Marking a queue item needs permission to update annotations" */
    it("refuses an annotator who may only view the project", async () => {
      const item = await createQueueItem("unauthorized");

      await expect(
        viewerCaller.annotation.markQueueItemForDataset({
          queueItemId: item.id,
          projectId,
          marked: true,
        }),
      ).rejects.toThrow();

      const persisted = await prisma.annotationQueueItem.findFirst({
        where: { id: item.id, projectId },
      });
      expect(persisted!.markedForDatasetAt).toBeNull();
    });
  });
});
