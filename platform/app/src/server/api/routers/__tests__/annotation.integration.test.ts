/**
 * @vitest-environment node
 *
 * Integration tests for annotation CRUD via the tRPC router with a real database.
 * Annotations persist in Postgres via the service/repository; the router also
 * performs a best-effort ClickHouse sync (stubbed here) that must never block
 * the mutation.
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
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
      // A correction is read and written through the trace's own content
      // gates, and the summary is what decides the visibility-window half of
      // them. These tests are about the suggestion dual-write, so the window is
      // pinned open and the privacy policy is left to decide on its own.
      summary: {
        getByTraceId: async () => ({ redactedByVisibilityWindow: false }),
      },
    },
    organizations: {
      // The shared test user belongs to the org through the legacy TeamUser
      // row rather than a RoleBinding, so this is the lookup the protections
      // read falls back to.
      getUserOrgRoleByTeamId: async () => OrganizationUserRole.MEMBER,
    },
  }),
}));

/**
 * Every trace this suite writes to. The project is shared with other suites,
 * and corrections live one row per trace, so the sweeps below stay on the
 * traces this file owns.
 */
const TRACE_ID_PREFIX = "test-trace-annotation";

describe("Annotation CRUD", () => {
  const projectId = "test-project-id";
  const traceId = `${TRACE_ID_PREFIX}-integration`;
  let caller: ReturnType<typeof appRouter.createCaller>;

  const sweepOverlays = () =>
    prisma.traceEditOverlay.deleteMany({
      where: { projectId, traceId: { startsWith: TRACE_ID_PREFIX } },
    });

  beforeAll(async () => {
    await prisma.annotation.deleteMany({ where: { projectId } });
    await sweepOverlays();

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
    await sweepOverlays();
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

    /** @scenario "Clearing the suggestion takes the corrected output back off" */
    it("removes the corrected output and keeps the other edits", async () => {
      const clearedTraceId = "test-trace-annotation-suggestion-cleared";
      await prisma.traceEditOverlay.deleteMany({
        where: { projectId, traceId: clearedTraceId },
      });
      await caller.traceEditOverlay.upsert({
        projectId,
        traceId: clearedTraceId,
        patch: {
          version: 1,
          spans: [{ spanId: "span-1", name: "cleaned up" }],
          deletedSpanIds: [],
        },
      });

      const created = await caller.annotation.create({
        projectId,
        traceId: clearedTraceId,
        comment: "wrong output",
        expectedOutput: "the right answer",
        scoreOptions: {},
      });
      expect((await overlayFor(clearedTraceId))!.patch).toMatchObject({
        trace: { output: { value: "the right answer" } },
      });

      await caller.annotation.updateByTraceId({
        id: created.id,
        projectId,
        traceId: clearedTraceId,
        comment: "never mind",
        expectedOutput: "",
        scoreOptions: {},
      });

      const overlay = await overlayFor(clearedTraceId);
      expect(overlay!.patch).toMatchObject({
        spans: [{ spanId: "span-1", name: "cleaned up" }],
      });
      expect((overlay!.patch as { trace?: unknown }).trace).toBeUndefined();
    });

    /** @scenario "Clearing the only suggestion returns the trace to uncorrected" */
    it("removes the correction entirely when the suggestion was all of it", async () => {
      const onlySuggestionTraceId = "test-trace-annotation-suggestion-only";

      const created = await caller.annotation.create({
        projectId,
        traceId: onlySuggestionTraceId,
        comment: "wrong output",
        expectedOutput: "the right answer",
        scoreOptions: {},
      });
      expect(await overlayFor(onlySuggestionTraceId)).not.toBeNull();

      await caller.annotation.updateByTraceId({
        id: created.id,
        projectId,
        traceId: onlySuggestionTraceId,
        comment: "never mind",
        expectedOutput: "",
        scoreOptions: {},
      });

      expect(await overlayFor(onlySuggestionTraceId)).toBeNull();
    });

    /** @scenario "Re-saving a comment does not re-assert the suggestion it opened with" */
    it("leaves a newer correction alone when the suggestion did not change", async () => {
      const staleTraceId = "test-trace-annotation-suggestion-stale";

      const created = await caller.annotation.create({
        projectId,
        traceId: staleTraceId,
        comment: "wrong output",
        expectedOutput: "the first answer",
        scoreOptions: {},
      });

      await caller.traceEditOverlay.upsert({
        projectId,
        traceId: staleTraceId,
        patch: {
          version: 1,
          trace: { output: { value: "a newer answer" } },
          spans: [],
          deletedSpanIds: [],
        },
      });
      const before = await overlayFor(staleTraceId);

      await caller.annotation.updateByTraceId({
        id: created.id,
        projectId,
        traceId: staleTraceId,
        comment: "adding a thought",
        expectedOutput: "the first answer",
        scoreOptions: {},
      });

      const after = await overlayFor(staleTraceId);
      expect(after!.patch).toMatchObject({
        trace: { output: { value: "a newer answer" } },
      });
      expect(after!.updatedAt).toEqual(before!.updatedAt);
    });

    /** @scenario "A save that never mentions the suggestion keeps the stored one" */
    it("keeps the suggestion when the save never mentions it", async () => {
      const annotateOnlyTraceId = "test-trace-annotation-annotate-only";

      const created = await caller.annotation.create({
        projectId,
        traceId: annotateOnlyTraceId,
        comment: "wrong output",
        expectedOutput: "the right answer",
        scoreOptions: {},
      });
      const before = await overlayFor(annotateOnlyTraceId);

      const updated = await caller.annotation.updateByTraceId({
        id: created.id,
        projectId,
        traceId: annotateOnlyTraceId,
        comment: "still wrong, adding a score",
        scoreOptions: {},
      });

      expect(updated.expectedOutput).toBe("the right answer");
      const after = await overlayFor(annotateOnlyTraceId);
      expect(after!.patch).toMatchObject({
        trace: { output: { value: "the right answer" } },
      });
      expect(after!.updatedAt).toEqual(before!.updatedAt);
    });

    /** @scenario "Saving a comment with an empty suggestion never removes a correction" */
    it("keeps the correction when a comment carries no suggestion text", async () => {
      const commentFormTraceId = "test-trace-annotation-comment-form";
      await prisma.traceEditOverlay.deleteMany({
        where: { projectId, traceId: commentFormTraceId },
      });
      await caller.traceEditOverlay.upsert({
        projectId,
        traceId: commentFormTraceId,
        patch: {
          version: 1,
          trace: { output: { value: "corrected in the drawer" } },
          spans: [],
          deletedSpanIds: [],
        },
      });

      await caller.annotation.create({
        projectId,
        traceId: commentFormTraceId,
        comment: "looks fine now",
        expectedOutput: "",
        scoreOptions: {},
      });

      expect((await overlayFor(commentFormTraceId))!.patch).toMatchObject({
        trace: { output: { value: "corrected in the drawer" } },
      });
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

  describe("given an annotator who may create annotations but not update them", () => {
    const createOnlyTraceId = "test-trace-annotation-create-only";
    const customRoleName = "Suggestion author (annotation integration test)";
    let createOnlyCaller: ReturnType<typeof appRouter.createCaller>;
    let createOnlyUserId: string;
    let createOnlyOrganizationId: string;

    beforeAll(async () => {
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { teamId: true, team: { select: { organizationId: true } } },
      });
      createOnlyOrganizationId = project.team.organizationId;

      const user = await prisma.user.upsert({
        where: { email: "annotation-create-only@example.com" },
        update: {},
        create: {
          name: "Create Only",
          email: "annotation-create-only@example.com",
        },
      });
      createOnlyUserId = user.id;

      const customRole = await prisma.customRole.upsert({
        where: {
          organizationId_name: {
            organizationId: createOnlyOrganizationId,
            name: customRoleName,
          },
        },
        update: {
          permissions: [
            "traces:view",
            "annotations:view",
            "annotations:create",
          ],
        },
        create: {
          organizationId: createOnlyOrganizationId,
          name: customRoleName,
          permissions: [
            "traces:view",
            "annotations:view",
            "annotations:create",
          ],
        },
      });

      await prisma.organizationUser.upsert({
        where: {
          userId_organizationId: {
            userId: createOnlyUserId,
            organizationId: createOnlyOrganizationId,
          },
        },
        update: {},
        create: {
          userId: createOnlyUserId,
          organizationId: createOnlyOrganizationId,
          role: OrganizationUserRole.MEMBER,
        },
      });
      // Re-running against a shared local database must not trip the binding's
      // uniqueness, and the guarded helper refuses the sweep outright if any
      // of these ids is still unassigned.
      await cleanupTestRows(prisma, [
        [
          "roleBinding",
          {
            userId: createOnlyUserId,
            organizationId: createOnlyOrganizationId,
            scopeId: project.teamId,
          },
        ],
      ]);
      await prisma.roleBinding.create({
        data: {
          organizationId: createOnlyOrganizationId,
          userId: createOnlyUserId,
          role: TeamUserRole.CUSTOM,
          customRoleId: customRole.id,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: project.teamId,
        },
      });

      createOnlyCaller = appRouter.createCaller(
        createInnerTRPCContext({
          session: { user: { id: createOnlyUserId }, expires: "1" },
        }),
      );
    });

    afterAll(async () => {
      await cleanupTestRows(prisma, [
        ["annotation", { projectId, userId: createOnlyUserId }],
        [
          "roleBinding",
          {
            userId: createOnlyUserId,
            organizationId: createOnlyOrganizationId,
          },
        ],
        [
          "organizationUser",
          {
            userId: createOnlyUserId,
            organizationId: createOnlyOrganizationId,
          },
        ],
        ["user", { id: createOnlyUserId }],
        [
          "customRole",
          { organizationId: createOnlyOrganizationId, name: customRoleName },
        ],
      ]);
    });

    /** @scenario "An annotator who may only create annotations does not move the correction" */
    it("saves the annotation and leaves the correction alone", async () => {
      const created = await createOnlyCaller.annotation.create({
        projectId,
        traceId: createOnlyTraceId,
        comment: "the output is wrong",
        expectedOutput: "the right answer",
        scoreOptions: {},
      });

      expect(created.expectedOutput).toBe("the right answer");
      expect(
        await prisma.traceEditOverlay.findUnique({
          where: {
            projectId_traceId: { projectId, traceId: createOnlyTraceId },
          },
        }),
      ).toBeNull();
    });
  });

  describe("given queue items marked for the dataset hand-off", () => {
    const queueTracePrefix = "test-trace-annotation-queue-mark";
    let viewerCaller: ReturnType<typeof appRouter.createCaller>;
    let ownerUserId: string;
    let viewerUserId: string;
    let viewerTeamId: string;
    let viewerOrganizationId: string;

    const createQueueItem = async (suffix: string, userId?: string) => {
      const itemTraceId = `${queueTracePrefix}-${suffix}`;
      await prisma.annotationQueueItem.deleteMany({
        where: { projectId, traceId: itemTraceId },
      });
      return prisma.annotationQueueItem.create({
        data: {
          projectId,
          traceId: itemTraceId,
          userId: userId ?? ownerUserId,
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
      viewerTeamId = project.teamId;
      viewerOrganizationId = project.team.organizationId;
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
      viewerUserId = readOnly.id;
      viewerCaller = appRouter.createCaller(
        createInnerTRPCContext({
          session: { user: { id: readOnly.id }, expires: "1" },
        }),
      );
    });

    afterAll(async () => {
      await cleanupTestRows(prisma, [
        [
          "annotationQueueItem",
          { projectId, traceId: { startsWith: queueTracePrefix } },
        ],
        ["teamUser", { userId: viewerUserId, teamId: viewerTeamId }],
        [
          "organizationUser",
          { userId: viewerUserId, organizationId: viewerOrganizationId },
        ],
        ["user", { id: viewerUserId }],
      ]);
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

    /** @scenario "Marks outlive being done and are read without their traces" */
    it("lists the marked items with their marks and nothing else", async () => {
      const finished = await createQueueItem("read-finished");
      const waiting = await createQueueItem("read-waiting");
      const unmarked = await createQueueItem("read-unmarked");

      for (const item of [finished, waiting]) {
        await caller.annotation.markQueueItemForDataset({
          queueItemId: item.id,
          projectId,
          marked: true,
        });
      }
      await caller.annotation.markQueueItemDone({
        queueItemId: finished.id,
        projectId,
      });

      const marked = await caller.annotation.getMarkedForDatasetItems({
        projectId,
      });

      const ids = marked.map((item) => item.id);
      expect(ids).toContain(finished.id);
      expect(ids).toContain(waiting.id);
      expect(ids).not.toContain(unmarked.id);

      const row = marked.find((item) => item.id === waiting.id)!;
      expect(Object.keys(row).sort()).toEqual([
        "id",
        "markedForDatasetAt",
        "traceId",
      ]);
      expect(row.traceId).toBe(waiting.traceId);
      expect(row.markedForDatasetAt).not.toBeNull();
    });

    /** @scenario "A teammate's marks are not part of my hand-off" */
    it("leaves out an item marked on someone else's queue", async () => {
      const mine = await createQueueItem("read-mine");
      const theirs = await createQueueItem("read-theirs", viewerUserId);

      await caller.annotation.markQueueItemForDataset({
        queueItemId: mine.id,
        projectId,
        marked: true,
      });
      // Marking is scoped to the caller's own items, so the teammate's mark is
      // planted directly rather than through the router.
      await prisma.annotationQueueItem.updateMany({
        where: { id: theirs.id, projectId },
        data: { markedForDatasetAt: new Date() },
      });

      const marked = await caller.annotation.getMarkedForDatasetItems({
        projectId,
      });

      const ids = marked.map((item) => item.id);
      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(theirs.id);
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

    /** @scenario "Marking a teammate's queue item is refused" */
    it("refuses to mark an item that belongs to someone else", async () => {
      const theirs = await createQueueItem("mark-theirs", viewerUserId);

      await expect(
        caller.annotation.markQueueItemForDataset({
          queueItemId: theirs.id,
          projectId,
          marked: true,
        }),
      ).rejects.toThrow();

      const persisted = await prisma.annotationQueueItem.findFirst({
        where: { id: theirs.id, projectId },
      });
      expect(persisted!.markedForDatasetAt).toBeNull();
    });

    /** @scenario "Clearing marks leaves a teammate's marks alone" */
    it("clears only the caller's own marks", async () => {
      const mine = await createQueueItem("clear-mine");
      const theirs = await createQueueItem("clear-theirs", viewerUserId);

      await caller.annotation.markQueueItemForDataset({
        queueItemId: mine.id,
        projectId,
        marked: true,
      });
      await prisma.annotationQueueItem.updateMany({
        where: { id: theirs.id, projectId },
        data: { markedForDatasetAt: new Date() },
      });

      const result = await caller.annotation.clearDatasetMarks({
        projectId,
        queueItemIds: [mine.id, theirs.id],
      });

      expect(result.cleared).toBe(1);
      const rows = await prisma.annotationQueueItem.findMany({
        where: { projectId, id: { in: [mine.id, theirs.id] } },
      });
      const marked = Object.fromEntries(
        rows.map((row) => [row.id, row.markedForDatasetAt !== null]),
      );
      expect(marked[mine.id]).toBe(false);
      expect(marked[theirs.id]).toBe(true);
    });
  });
});
