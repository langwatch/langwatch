/**
 * @vitest-environment node
 *
 * Integration tests for annotation CRUD via the tRPC router with a real database.
 * Annotations persist in Postgres via the service/repository; the router also
 * performs a best-effort ClickHouse sync (stubbed here) that must never block
 * the mutation.
 */

import { nanoid } from "nanoid";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { getAnnotatedTraceIds } from "~/server/filters/annotations";
import { mapTraceToDatasetEntry } from "~/server/tracer/tracesMapping";
import type { Trace } from "~/server/tracer/types";
import { ClickHouseTraceService } from "~/server/traces/clickhouse-trace.service";
import { applyOverlayToTrace } from "~/server/traces/edit-overlay/applyTraceEditOverlay";
import type { TraceEditOverlayPatch } from "~/server/traces/edit-overlay/traceEditOverlay.schemas";
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

vi.mock("~/server/app-layer/app", async () => {
  const clickhouseClients = await import(
    "~/server/clickhouse/clickhouseClient"
  );
  // The real composition over the real test database: `.permission()`
  // procedures decide through getApp().permissions (ADR-092), so a fake App
  // without it dies at the middleware, before the code this suite tests.
  const { permissionsServiceFor } = await import(
    "~/server/app-layer/permissions/runtime"
  );
  const { prisma: dbForPermissions } = await import("~/server/db");
  return {
    // Consumers that degrade without Redis read through this one.
    tryGetApp: () => null,
    getApp: () => ({
      permissions: permissionsServiceFor(dbForPermissions),
      // The trace service resolves its client through getApp().clickhouse now
      // (two-door access); the queue-item reads join real ClickHouse summaries,
      // so the facet delegates to the environment-configured client.
      clickhouse: {
        enabled: true,
        resolveClient: (tenantId: string) =>
          clickhouseClients.getClickHouseClientForTenant(tenantId),
        resolveOrganizationClient: async () => {
          throw new Error("no organization client in this suite");
        },
        allInstances: async () => [],
      },
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
  };
});

/**
 * Every trace this suite writes to. The project is shared with other suites,
 * and corrections live one row per trace, so the sweeps below stay on the
 * traces this file owns.
 */
const TRACE_ID_PREFIX = "test-trace-annotation";

/**
 * Which trace ids the project holds a trace for. Queueing a trace checks this
 * against ClickHouse before it writes anything, and the traces here only ever
 * exist in Postgres, so `null` stands for "every id sent resolves" and a set
 * narrows it for the tests that are about the guard itself.
 */
let resolvableTraceIds: Set<string> | null = null;

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

    vi.spyOn(
      ClickHouseTraceService.prototype,
      "findExistingTraceIds",
    ).mockImplementation(async ({ traceIds }) =>
      traceIds.filter((id) => resolvableTraceIds?.has(id) ?? true),
    );

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
    vi.restoreAllMocks();
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

  describe("given comments left on parts of a trace", () => {
    const anchoredTraceId = `${TRACE_ID_PREFIX}-anchored`;

    const commentOn = async ({
      traceId: onTraceId,
      comment,
      anchorKind,
      anchorId,
      anchorPath,
      expectedOutput,
    }: {
      traceId: string;
      comment: string;
      anchorKind?: "span" | "field" | "message";
      anchorId?: string;
      anchorPath?: string;
      expectedOutput?: string;
    }) =>
      caller.annotation.create({
        projectId,
        traceId: onTraceId,
        comment,
        scoreOptions: {},
        anchorKind,
        anchorId,
        anchorPath,
        expectedOutput,
      });

    /** @scenario "Commenting on a span records the span it was left on" */
    it("records the span, and copies nothing the span held", async () => {
      const created = await commentOn({
        traceId: anchoredTraceId,
        comment: "this search returned nothing",
        anchorKind: "span",
        anchorId: "span-search",
      });

      const persisted = await prisma.annotation.findFirstOrThrow({
        where: { id: created.id, projectId },
      });
      expect(persisted.anchorKind).toBe("span");
      expect(persisted.anchorId).toBe("span-search");
      expect(persisted.anchorPath).toBeNull();
      expect(persisted.comment).toBe("this search returned nothing");
      expect(persisted.expectedOutput).toBeNull();
    });

    /** @scenario "Commenting on a span's output records the field it was left on" */
    it("records the field, and the input separately from the output", async () => {
      const onOutput = await commentOn({
        traceId: anchoredTraceId,
        comment: "the output is wrong",
        anchorKind: "field",
        anchorId: "span-search",
        anchorPath: "output",
      });
      const onInput = await commentOn({
        traceId: anchoredTraceId,
        comment: "the query is wrong",
        anchorKind: "field",
        anchorId: "span-search",
        anchorPath: "input",
      });

      const rows = await prisma.annotation.findMany({
        where: { projectId, id: { in: [onOutput.id, onInput.id] } },
        select: { id: true, anchorKind: true, anchorPath: true },
      });
      expect(rows.find((row) => row.id === onOutput.id)).toMatchObject({
        anchorKind: "field",
        anchorPath: "output",
      });
      expect(rows.find((row) => row.id === onInput.id)).toMatchObject({
        anchorKind: "field",
        anchorPath: "input",
      });
    });

    /** @scenario "Commenting on the trace's own input, output or metadata records which one" */
    it("records which of the trace's own fields the comment is on", async () => {
      const created = await Promise.all(
        ["input", "output", "metadata.environment"].map((path) =>
          commentOn({
            traceId: anchoredTraceId,
            comment: `about ${path}`,
            anchorKind: "field",
            anchorId: anchoredTraceId,
            anchorPath: path,
          }),
        ),
      );

      const rows = await prisma.annotation.findMany({
        where: { projectId, id: { in: created.map((row) => row.id) } },
        select: { anchorKind: true, anchorId: true, anchorPath: true },
      });
      expect(rows.every((row) => row.anchorId === anchoredTraceId)).toBe(true);
      expect(rows.map((row) => row.anchorPath).sort()).toEqual([
        "input",
        "metadata.environment",
        "output",
      ]);
    });

    /** @scenario "Commenting on one message in a transcript records that message" */
    it("records the message it was left on and no other", async () => {
      const messageTraceId = `${TRACE_ID_PREFIX}-message`;
      await commentOn({
        traceId: messageTraceId,
        comment: "this answer went off",
        anchorKind: "message",
        anchorId: messageTraceId,
        anchorPath: "assistant-2-9f1c",
      });

      const onTrace = await caller.annotation.getByTraceId({
        projectId,
        traceId: messageTraceId,
      });
      expect(onTrace).toHaveLength(1);
      expect(onTrace[0]).toMatchObject({
        anchorKind: "message",
        anchorId: messageTraceId,
        anchorPath: "assistant-2-9f1c",
      });
      expect(
        onTrace.filter((row) => row.anchorPath === "assistant-3-1ab2"),
      ).toHaveLength(0);
    });

    it("refuses a comment that names a part without saying what kind it is", async () => {
      await expect(
        caller.annotation.create({
          projectId,
          traceId: anchoredTraceId,
          comment: "half an anchor",
          scoreOptions: {},
          anchorId: "span-search",
        }),
      ).rejects.toThrow();
    });

    /** @scenario "A comment cannot be moved to another part of the trace" */
    it("keeps the anchor when the comment is edited", async () => {
      const created = await commentOn({
        traceId: anchoredTraceId,
        comment: "the output is wrong",
        anchorKind: "field",
        anchorId: "span-immutable",
        anchorPath: "output",
      });

      const updated = await caller.annotation.updateByTraceId({
        id: created.id,
        projectId,
        traceId: anchoredTraceId,
        comment: "the output is wrong, here is why",
        scoreOptions: {},
      });

      expect(updated.comment).toBe("the output is wrong, here is why");
      expect(updated.anchorKind).toBe("field");
      expect(updated.anchorId).toBe("span-immutable");
      expect(updated.anchorPath).toBe("output");
    });

    /** @scenario "A comment about something this build does not recognise still reads" */
    it("reads a comment about an unrecognised kind of part as a comment about the trace", async () => {
      const futureTraceId = `${TRACE_ID_PREFIX}-future-anchor`;
      await prisma.annotation.create({
        data: {
          id: nanoid(),
          projectId,
          traceId: futureTraceId,
          comment: "left by a newer build",
          anchorKind: "gizmo",
          anchorId: "gizmo-1",
          anchorPath: "somewhere",
        },
      });
      await commentOn({
        traceId: futureTraceId,
        comment: "about the trace",
      });

      const onTrace = await caller.annotation.getByTraceId({
        projectId,
        traceId: futureTraceId,
      });

      expect(onTrace).toHaveLength(2);
      expect(
        onTrace.find((row) => row.comment === "left by a newer build"),
      ).toMatchObject({
        anchorKind: null,
        anchorId: null,
        anchorPath: null,
      });
    });

    /** @scenario "A trace commented only on one of its spans still counts as annotated" */
    it("counts a trace whose only comment is on a span as annotated", async () => {
      const spanOnlyTraceId = `${TRACE_ID_PREFIX}-span-only`;
      mockAddAnnotation.mockClear();

      const created = await commentOn({
        traceId: spanOnlyTraceId,
        comment: "this tool call misfired",
        anchorKind: "span",
        anchorId: "span-tool",
      });

      // The has-annotation filter in search reads the ClickHouse sync, and the
      // trigger filters read getAnnotatedTraceIds. Both answer "has a human
      // touched this trace", so both count a comment on one of its spans.
      expect(mockAddAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: projectId,
          traceId: spanOnlyTraceId,
          annotationId: created.id,
        }),
      );
      const annotated = await getAnnotatedTraceIds({
        projectId,
        startDate: new Date(Date.now() - 60_000),
        endDate: new Date(Date.now() + 60_000),
      });
      expect(annotated).toContain(spanOnlyTraceId);
    });

    /** @scenario "A comment on one part of a trace never becomes a queue item" */
    it("creates no queue item for a comment on a part of the trace", async () => {
      const queuelessTraceId = `${TRACE_ID_PREFIX}-queueless`;
      for (const spanId of ["span-1", "span-2", "span-3"]) {
        await commentOn({
          traceId: queuelessTraceId,
          comment: `about ${spanId}`,
          anchorKind: "span",
          anchorId: spanId,
        });
      }

      expect(
        await prisma.annotationQueueItem.count({
          where: { projectId, traceId: queuelessTraceId },
        }),
      ).toBe(0);
    });

    /** @scenario "Sending a commented trace to a queue sends the trace once" */
    it("holds one queue item for a trace carrying three comments on its spans", async () => {
      const queuedTraceId = `${TRACE_ID_PREFIX}-queued-once`;
      await prisma.annotationQueueItem.deleteMany({
        where: { projectId, traceId: queuedTraceId },
      });
      for (const spanId of ["span-1", "span-2", "span-3"]) {
        await commentOn({
          traceId: queuedTraceId,
          comment: `about ${spanId}`,
          anchorKind: "span",
          anchorId: spanId,
        });
      }

      const user = await getTestUser();
      await caller.annotation.createQueueItem({
        projectId,
        traceIds: [queuedTraceId],
        annotators: [`user-${user.id}`],
      });

      expect(
        await prisma.annotationQueueItem.count({
          where: { projectId, traceId: queuedTraceId },
        }),
      ).toBe(1);
      await prisma.annotationQueueItem.deleteMany({
        where: { projectId, traceId: queuedTraceId },
      });
    });

    describe("given a trace with one comment about it and three about its spans", () => {
      const commentedTraceId = `${TRACE_ID_PREFIX}-every-comment`;
      const spanIds = ["span-1", "span-2", "span-3"];
      const everyComment = [
        "about span-1",
        "about span-2",
        "about span-3",
        "the whole trace is off",
      ];

      beforeAll(async () => {
        await prisma.annotation.deleteMany({
          where: { projectId, traceId: commentedTraceId },
        });
        await commentOn({
          traceId: commentedTraceId,
          comment: "the whole trace is off",
        });
        for (const spanId of spanIds) {
          await commentOn({
            traceId: commentedTraceId,
            comment: `about ${spanId}`,
            anchorKind: "span",
            anchorId: spanId,
          });
        }
      });

      /** @scenario "The project's annotations list holds every comment with its target named" */
      /** @scenario "Exporting the annotations list exports the rows the list shows" */
      it("lists and exports all four comments, each naming what it is about", async () => {
        const listed = await caller.annotation.getAll({ projectId });

        const forTrace = listed.filter(
          (row) => row.traceId === commentedTraceId,
        );
        expect(forTrace.map((row) => row.comment).sort()).toEqual(everyComment);
        // The export is taken from the rows the list holds, so it carries the
        // same four rows and the same anchors.
        expect(
          forTrace
            .filter((row) => row.anchorKind === "span")
            .map((row) => row.anchorId)
            .sort(),
        ).toEqual(spanIds);
      });

      /** @scenario "A dataset column of annotations carries every comment, each naming its target" */
      it("fills a dataset annotations column with all four comments", async () => {
        const annotations = await caller.annotation.getByTraceIds({
          projectId,
          traceIds: [commentedTraceId],
        });

        const [row] = mapTraceToDatasetEntry(
          {
            trace_id: commentedTraceId,
            annotations,
          } as never,
          {
            trace_id: { source: "trace_id" },
            comments: { source: "annotations", key: "comment" },
            readable: { source: "annotations", key: "ai_readable" },
          },
          new Set(),
        );

        expect(
          (JSON.parse(row!.comments as string) as string[]).sort(),
        ).toEqual(everyComment);
        // The readable column is one text a reader reads straight through, one
        // review per line with a rule between them, not a list to parse. A
        // dataset row leaves the product, so each anchored review names its
        // span by id as well.
        const readable = (row!.readable as string).split("\n---\n");
        expect(readable).toHaveLength(everyComment.length);
        expect(
          readable.filter((line) => line.includes("(on span (span-")),
        ).toHaveLength(spanIds.length);
      });

      it("still narrows to the trace's own comments when a caller asks", async () => {
        const traceLevel = await caller.annotation.getByTraceIds({
          projectId,
          traceIds: [commentedTraceId],
          anchor: "trace",
        });

        expect(traceLevel.map((row) => row.comment)).toEqual([
          "the whole trace is off",
        ]);
      });

      /** @scenario "A queue item carries every comment about its trace" */
      it("carries all four comments on the queue item", async () => {
        await prisma.annotationQueueItem.deleteMany({
          where: { projectId, traceId: commentedTraceId },
        });
        const user = await getTestUser();
        const item = await prisma.annotationQueueItem.create({
          data: { projectId, traceId: commentedTraceId, userId: user.id },
        });

        const queue = await caller.annotation.getOptimizedAnnotationQueues({
          projectId,
          selectedAnnotations: "pending",
          pageSize: 50,
          pageOffset: 0,
        });

        const enriched = queue.assignedQueueItems.find(
          (queueItem) => queueItem.id === item.id,
        );
        expect(enriched?.annotations.map((row) => row.comment).sort()).toEqual(
          everyComment,
        );
        expect(
          enriched?.annotations.filter((row) => row.anchorKind === "span"),
        ).toHaveLength(3);
        await prisma.annotationQueueItem.deleteMany({
          where: { projectId, traceId: commentedTraceId },
        });
      });
    });

    describe("given a comment on a span's output carrying a suggestion", () => {
      const suggestionTraceId = `${TRACE_ID_PREFIX}-span-suggestion`;

      const overlayPatchFor = async (forTraceId: string) => {
        const row = await prisma.traceEditOverlay.findUnique({
          where: { projectId_traceId: { projectId, traceId: forTraceId } },
        });
        return row?.patch as TraceEditOverlayPatch | undefined;
      };

      /** @scenario "A suggestion left with a comment on a span output becomes that span's correction" */
      it("records the suggestion and corrects that span's output", async () => {
        await prisma.traceEditOverlay.deleteMany({
          where: { projectId, traceId: suggestionTraceId },
        });

        const created = await commentOn({
          traceId: suggestionTraceId,
          comment: "this search should have found Amsterdam",
          anchorKind: "field",
          anchorId: "span-search",
          anchorPath: "output",
          expectedOutput: "Amsterdam",
        });

        expect(created.expectedOutput).toBe("Amsterdam");
        const patch = await overlayPatchFor(suggestionTraceId);
        expect(patch).toMatchObject({
          version: 1,
          spans: [
            {
              spanId: "span-search",
              output: { type: "text", value: "Amsterdam" },
            },
          ],
        });
        expect(patch?.trace).toBeUndefined();
      });

      /** @scenario "A field suggested through a comment reaches the dataset" */
      it("carries the suggested output into the dataset row for that span", async () => {
        const datasetTraceId = `${TRACE_ID_PREFIX}-span-suggestion-dataset`;
        await prisma.traceEditOverlay.deleteMany({
          where: { projectId, traceId: datasetTraceId },
        });
        await commentOn({
          traceId: datasetTraceId,
          comment: "this search should have found Amsterdam",
          anchorKind: "field",
          anchorId: "span-search",
          anchorPath: "output",
          expectedOutput: "Amsterdam",
        });

        const capturedTrace = {
          trace_id: datasetTraceId,
          project_id: projectId,
          metadata: {},
          timestamps: {
            started_at: 1_000,
            inserted_at: 1_000,
            updated_at: 1_000,
          },
          input: { value: "what is the capital of the Netherlands?" },
          output: { value: "Rotterdam" },
          spans: [
            {
              span_id: "span-search",
              trace_id: datasetTraceId,
              project_id: projectId,
              type: "tool",
              name: "search",
              input: { type: "text", value: "capital of the Netherlands" },
              output: { type: "text", value: "Rotterdam" },
              timestamps: { started_at: 1_000, finished_at: 1_100 },
            },
          ],
        } as unknown as Trace;

        const patch = await overlayPatchFor(datasetTraceId);
        const corrected = applyOverlayToTrace({
          trace: capturedTrace,
          patch: patch!,
        });

        const [row] = mapTraceToDatasetEntry(
          corrected as never,
          {
            answer: { source: "spans", key: "search", subkey: "output" },
          },
          new Set(),
        );

        expect(JSON.stringify(row?.answer)).toContain("Amsterdam");
        expect(JSON.stringify(row?.answer)).not.toContain("Rotterdam");
        expect(capturedTrace.spans?.[0]?.output).toEqual({
          type: "text",
          value: "Rotterdam",
        });
      });

      it("leaves the corrected trace output alone", async () => {
        const besideTraceId = `${TRACE_ID_PREFIX}-span-suggestion-beside`;
        await prisma.traceEditOverlay.deleteMany({
          where: { projectId, traceId: besideTraceId },
        });
        await caller.traceEditOverlay.upsert({
          projectId,
          traceId: besideTraceId,
          patch: {
            version: 1,
            trace: { output: { value: "corrected in the drawer" } },
            spans: [],
            deletedSpanIds: [],
          },
        });

        await commentOn({
          traceId: besideTraceId,
          comment: "this span is wrong too",
          anchorKind: "field",
          anchorId: "span-search",
          anchorPath: "output",
          expectedOutput: "Amsterdam",
        });

        expect(await overlayPatchFor(besideTraceId)).toMatchObject({
          trace: { output: { value: "corrected in the drawer" } },
          spans: [
            {
              spanId: "span-search",
              output: { type: "text", value: "Amsterdam" },
            },
          ],
        });
      });

      it("withdraws the span's correction when the suggestion is cleared", async () => {
        const clearedTraceId = `${TRACE_ID_PREFIX}-span-suggestion-cleared`;
        await prisma.traceEditOverlay.deleteMany({
          where: { projectId, traceId: clearedTraceId },
        });

        const created = await commentOn({
          traceId: clearedTraceId,
          comment: "this span is wrong",
          anchorKind: "field",
          anchorId: "span-search",
          anchorPath: "output",
          expectedOutput: "Amsterdam",
        });
        await caller.annotation.updateByTraceId({
          id: created.id,
          projectId,
          traceId: clearedTraceId,
          comment: "never mind",
          expectedOutput: "",
          scoreOptions: {},
        });

        expect(await overlayPatchFor(clearedTraceId)).toBeUndefined();
      });

      it("carries no correction for a comment on an attribute row", async () => {
        const attributeTraceId = `${TRACE_ID_PREFIX}-attribute-suggestion`;
        await prisma.traceEditOverlay.deleteMany({
          where: { projectId, traceId: attributeTraceId },
        });

        await commentOn({
          traceId: attributeTraceId,
          comment: "this temperature is too high",
          anchorKind: "field",
          anchorId: "span-search",
          anchorPath: "params.temperature",
          expectedOutput: "0.1",
        });

        expect(await overlayPatchFor(attributeTraceId)).toBeUndefined();
      });

      it("carries no correction for a comment on a message", async () => {
        const messageTraceId = `${TRACE_ID_PREFIX}-message-suggestion`;
        await prisma.traceEditOverlay.deleteMany({
          where: { projectId, traceId: messageTraceId },
        });

        await commentOn({
          traceId: messageTraceId,
          comment: "this message went off",
          anchorKind: "message",
          anchorId: messageTraceId,
          anchorPath: "assistant-2-9f1c",
          expectedOutput: "something else",
        });

        expect(await overlayPatchFor(messageTraceId)).toBeUndefined();
      });
    });

    describe("given a comment on the trace's own input carrying a suggestion", () => {
      const inputTraceId = `${TRACE_ID_PREFIX}-trace-input-suggestion`;

      const overlayPatchFor = async (forTraceId: string) => {
        const row = await prisma.traceEditOverlay.findUnique({
          where: { projectId_traceId: { projectId, traceId: forTraceId } },
        });
        return row?.patch as TraceEditOverlayPatch | undefined;
      };

      const suggestInput = ({
        traceId: onTraceId,
        expectedOutput,
      }: {
        traceId: string;
        expectedOutput: string;
      }) =>
        commentOn({
          traceId: onTraceId,
          comment: "the user asked something else",
          anchorKind: "field",
          anchorId: onTraceId,
          anchorPath: "input",
          expectedOutput,
        });

      /** @scenario "A suggestion on the trace's own input becomes the corrected trace input" */
      it("records the suggestion and corrects the trace input", async () => {
        await prisma.traceEditOverlay.deleteMany({
          where: { projectId, traceId: inputTraceId },
        });

        const created = await suggestInput({
          traceId: inputTraceId,
          expectedOutput: "what is the capital of the Netherlands?",
        });

        expect(created.expectedOutput).toBe(
          "what is the capital of the Netherlands?",
        );
        const patch = await overlayPatchFor(inputTraceId);
        expect(patch).toMatchObject({
          version: 1,
          trace: {
            input: { value: "what is the capital of the Netherlands?" },
          },
        });
        expect(patch?.trace?.output).toBeUndefined();
      });

      it("moves the corrected input when the suggestion is edited", async () => {
        const editedTraceId = `${TRACE_ID_PREFIX}-trace-input-edited`;
        await prisma.traceEditOverlay.deleteMany({
          where: { projectId, traceId: editedTraceId },
        });

        const created = await suggestInput({
          traceId: editedTraceId,
          expectedOutput: "the first question",
        });
        await caller.annotation.updateByTraceId({
          id: created.id,
          projectId,
          traceId: editedTraceId,
          comment: "the user asked something else",
          expectedOutput: "the second question",
          scoreOptions: {},
        });

        expect(await overlayPatchFor(editedTraceId)).toMatchObject({
          trace: { input: { value: "the second question" } },
        });
      });

      it("withdraws only the corrected input when the suggestion is cleared", async () => {
        const withdrawnTraceId = `${TRACE_ID_PREFIX}-trace-input-withdrawn`;
        await prisma.traceEditOverlay.deleteMany({
          where: { projectId, traceId: withdrawnTraceId },
        });
        await caller.traceEditOverlay.upsert({
          projectId,
          traceId: withdrawnTraceId,
          patch: {
            version: 1,
            trace: { output: { value: "corrected in the drawer" } },
            spans: [],
            deletedSpanIds: [],
          },
        });

        const created = await suggestInput({
          traceId: withdrawnTraceId,
          expectedOutput: "the real question",
        });
        expect(await overlayPatchFor(withdrawnTraceId)).toMatchObject({
          trace: {
            input: { value: "the real question" },
            output: { value: "corrected in the drawer" },
          },
        });

        await caller.annotation.updateByTraceId({
          id: created.id,
          projectId,
          traceId: withdrawnTraceId,
          comment: "never mind",
          expectedOutput: "",
          scoreOptions: {},
        });

        const patch = await overlayPatchFor(withdrawnTraceId);
        expect(patch?.trace).toEqual({
          output: { value: "corrected in the drawer" },
        });
      });
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

  describe("given traces sent to an annotation queue", () => {
    const sendTracePrefix = "test-trace-annotation-send";
    let annotatorId: string;

    const queuedTraceIds = async () =>
      (
        await prisma.annotationQueueItem.findMany({
          where: { projectId, traceId: { startsWith: sendTracePrefix } },
          select: { traceId: true },
          orderBy: { traceId: "asc" },
        })
      ).map((row) => row.traceId);

    beforeAll(async () => {
      annotatorId = (await getTestUser()).id;
    });

    beforeEach(async () => {
      resolvableTraceIds = null;
      await prisma.annotationQueueItem.deleteMany({
        where: { projectId, traceId: { startsWith: sendTracePrefix } },
      });
    });

    afterAll(async () => {
      resolvableTraceIds = null;
      await cleanupTestRows(prisma, [
        [
          "annotationQueueItem",
          { projectId, traceId: { startsWith: sendTracePrefix } },
        ],
      ]);
    });

    /** @scenario "Sending traces for annotation skips ids that resolve to no trace" */
    it("queues the ids that resolve to a trace and skips the rest", async () => {
      const live = `${sendTracePrefix}-live`;
      const gone = `${sendTracePrefix}-gone`;
      resolvableTraceIds = new Set([live]);

      const result = await caller.annotation.createQueueItem({
        projectId,
        traceIds: [live, gone],
        annotators: [`user-${annotatorId}`],
      });

      expect(result).toEqual({ created: 1, skipped: 1 });
      expect(await queuedTraceIds()).toEqual([live]);
    });

    /** @scenario "Blank ids are dropped before anything is queued" */
    it("drops an empty id and one made of whitespace", async () => {
      const live = `${sendTracePrefix}-blank`;
      resolvableTraceIds = new Set([live]);

      const result = await caller.annotation.createQueueItem({
        projectId,
        traceIds: ["", "   ", live],
        annotators: [`user-${annotatorId}`],
      });

      expect(result).toEqual({ created: 1, skipped: 2 });
      expect(await queuedTraceIds()).toEqual([live]);
    });

    /** @scenario "The same trace sent twice in one send is queued once" */
    it("queues a repeated id once", async () => {
      const live = `${sendTracePrefix}-twice`;
      resolvableTraceIds = new Set([live]);

      const result = await caller.annotation.createQueueItem({
        projectId,
        traceIds: [live, live],
        annotators: [`user-${annotatorId}`],
      });

      expect(result).toEqual({ created: 1, skipped: 1 });
      expect(await queuedTraceIds()).toEqual([live]);
    });

    /** @scenario "Sending traces for annotation skips ids that resolve to no trace" */
    it("writes nothing when none of the ids resolves", async () => {
      resolvableTraceIds = new Set<string>();

      const result = await caller.annotation.createQueueItem({
        projectId,
        traceIds: [`${sendTracePrefix}-none-1`, `${sendTracePrefix}-none-2`],
        annotators: [`user-${annotatorId}`],
      });

      expect(result).toEqual({ created: 0, skipped: 2 });
      expect(await queuedTraceIds()).toEqual([]);
    });
  });

  describe("given queue items on the reviewer's own queue", () => {
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

    describe("when an item is removed from the queue", () => {
      /** @scenario "Removing an item whose trace is gone takes it out of the queue" */
      it("takes the caller's own item out of the queue", async () => {
        const mine = await createQueueItem("delete-mine");

        const result = await caller.annotation.deleteQueueItems({
          projectId,
          queueItemIds: [mine.id],
        });

        expect(result.deleted).toBe(1);
        expect(
          await prisma.annotationQueueItem.findFirst({
            where: { id: mine.id, projectId },
          }),
        ).toBeNull();
      });

      /** @scenario "Removing a teammate's queue item is refused" */
      it("leaves an item on someone else's queue where it is", async () => {
        const mine = await createQueueItem("delete-batch-mine");
        const theirs = await createQueueItem("delete-theirs", viewerUserId);

        const result = await caller.annotation.deleteQueueItems({
          projectId,
          queueItemIds: [mine.id, theirs.id],
        });

        expect(result.deleted).toBe(1);
        expect(
          await prisma.annotationQueueItem.findFirst({
            where: { id: theirs.id, projectId },
          }),
        ).not.toBeNull();
      });

      /** @scenario "Removing a teammate's queue item is refused" */
      it("refuses a reviewer who may only view the project", async () => {
        const item = await createQueueItem("delete-unauthorized");

        await expect(
          viewerCaller.annotation.deleteQueueItems({
            projectId,
            queueItemIds: [item.id],
          }),
        ).rejects.toThrow();

        expect(
          await prisma.annotationQueueItem.findFirst({
            where: { id: item.id, projectId },
          }),
        ).not.toBeNull();
      });
    });

    describe("when an item is marked done", () => {
      /** @scenario "A reviewer finishes an item on their own queue" */
      it("records the caller's own item as done", async () => {
        const mine = await createQueueItem("done-mine");

        const result = await caller.annotation.markQueueItemDone({
          queueItemId: mine.id,
          projectId,
        });

        expect(result.doneAt).not.toBeNull();
        const persisted = await prisma.annotationQueueItem.findFirst({
          where: { id: mine.id, projectId },
        });
        expect(persisted!.doneAt).not.toBeNull();
      });

      /** @scenario "Finishing a teammate's queue item is refused" */
      it("leaves an item on someone else's queue waiting", async () => {
        const theirs = await createQueueItem("done-theirs", viewerUserId);

        await expect(
          caller.annotation.markQueueItemDone({
            queueItemId: theirs.id,
            projectId,
          }),
        ).rejects.toThrow();

        const persisted = await prisma.annotationQueueItem.findFirst({
          where: { id: theirs.id, projectId },
        });
        expect(persisted!.doneAt).toBeNull();
      });
    });

    describe("when the list is read for a date range", () => {
      /** @scenario "A picked date range narrows a queue page to when items were queued" */
      it("returns only the items queued inside the range", async () => {
        const inside = await createQueueItem("range-inside");
        const outside = await createQueueItem("range-outside");
        await prisma.annotationQueueItem.update({
          where: { id: inside.id, projectId },
          data: { createdAt: new Date("2026-05-15T00:00:00Z") },
        });
        await prisma.annotationQueueItem.update({
          where: { id: outside.id, projectId },
          data: { createdAt: new Date("2026-01-01T00:00:00Z") },
        });

        const result = await caller.annotation.getOptimizedAnnotationQueues({
          projectId,
          selectedAnnotations: "pending",
          pageSize: 100,
          pageOffset: 0,
          startDate: new Date("2026-05-01T00:00:00Z"),
          endDate: new Date("2026-06-01T00:00:00Z"),
        });

        const ids = result.assignedQueueItems.map((item) => item.id);
        expect(ids).toContain(inside.id);
        expect(ids).not.toContain(outside.id);
      });
    });
  });
});
