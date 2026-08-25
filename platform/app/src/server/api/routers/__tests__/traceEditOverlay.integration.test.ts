/**
 * @vitest-environment node
 *
 * Storage lifecycle for reviewer corrections through the tRPC router against a
 * real Postgres: one row per trace, authored, replaceable, removable, and safe
 * to read when the stored patch no longer matches the contract.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrganizationUserRole, TeamUserRole } from "~/generated/prisma/client";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { getTestUser } from "../../../../utils/testUtils";
import { globalForApp } from "../../../app-layer/app";
import { createTestApp } from "../../../app-layer/presets";
import { prisma } from "../../../db";
import type { TraceEditOverlayPatch } from "../../../traces/edit-overlay/traceEditOverlay.schemas";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

const PROJECT_ID = "test-project-id";
/** Every trace this suite writes starts with it, so cleanup can be scoped. */
const TRACE_ID_PREFIX = "trace-edit-overlay";
const TRACE_ID = `${TRACE_ID_PREFIX}-integration`;

const renameSpanPatch = (name: string): TraceEditOverlayPatch => ({
  version: 1,
  spans: [{ spanId: "span-1", name }],
  deletedSpanIds: [],
});

const callerFor = (userId: string) =>
  appRouter.createCaller(
    createInnerTRPCContext({
      session: { user: { id: userId }, expires: "1" },
    }),
  );

describe("Trace edit overlay storage", () => {
  let previousApp: typeof globalForApp.__langwatch_app;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let otherReviewer: ReturnType<typeof appRouter.createCaller>;
  let viewer: ReturnType<typeof appRouter.createCaller>;
  let authorId: string;
  let otherReviewerId: string;
  let readOnlyId: string;
  let teamId: string;
  let organizationId: string;

  beforeAll(async () => {
    previousApp = globalForApp.__langwatch_app;
    globalForApp.__langwatch_app = createTestApp();

    const user = await getTestUser();
    authorId = user.id;
    caller = callerFor(user.id);

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: PROJECT_ID },
      select: { teamId: true, team: { select: { organizationId: true } } },
    });
    teamId = project.teamId;
    organizationId = project.team.organizationId;

    const joinProject = async ({
      userId,
      role,
    }: {
      userId: string;
      role: TeamUserRole;
    }) => {
      await prisma.teamUser.upsert({
        where: { userId_teamId: { userId, teamId: project.teamId } },
        update: { role },
        create: { userId, teamId: project.teamId, role },
      });
      await prisma.organizationUser.upsert({
        where: { userId_organizationId: { userId, organizationId } },
        update: {},
        create: {
          userId,
          organizationId,
          role: OrganizationUserRole.MEMBER,
        },
      });
    };

    const second = await prisma.user.upsert({
      where: { email: "trace-edit-overlay-reviewer@example.com" },
      update: {},
      create: {
        name: "Second Reviewer",
        email: "trace-edit-overlay-reviewer@example.com",
      },
    });
    otherReviewerId = second.id;
    await joinProject({ userId: second.id, role: TeamUserRole.MEMBER });
    otherReviewer = callerFor(second.id);

    const readOnly = await prisma.user.upsert({
      where: { email: "trace-edit-overlay-viewer@example.com" },
      update: {},
      create: {
        name: "Read Only",
        email: "trace-edit-overlay-viewer@example.com",
      },
    });
    readOnlyId = readOnly.id;
    await joinProject({ userId: readOnly.id, role: TeamUserRole.VIEWER });
    viewer = callerFor(readOnly.id);

    // Scoped to this suite's own trace ids: the project is a shared fixture, so
    // a project-wide delete would take another suite's rows with it.
    await prisma.traceEditOverlay.deleteMany({
      where: {
        projectId: PROJECT_ID,
        traceId: { startsWith: TRACE_ID_PREFIX },
      },
    });
  });

  afterAll(async () => {
    const reviewers = [otherReviewerId, readOnlyId];
    await cleanupTestRows(prisma, [
      [
        "traceEditOverlay",
        {
          projectId: PROJECT_ID,
          traceId: { startsWith: TRACE_ID_PREFIX },
        },
      ],
      ["teamUser", { userId: { in: reviewers }, teamId }],
      ["organizationUser", { userId: { in: reviewers }, organizationId }],
      ["user", { id: { in: reviewers } }],
    ]);
    globalForApp.__langwatch_app = previousApp;
  });

  describe("given a trace nobody has corrected", () => {
    /** @scenario "A trace with no correction reads as uncorrected" */
    it("returns no correction", async () => {
      const overlay = await caller.traceEditOverlay.getByTraceId({
        projectId: PROJECT_ID,
        traceId: "trace-edit-overlay-never-corrected",
      });

      expect(overlay).toBeNull();
    });

    /** @scenario "A correction that changes nothing is rejected" */
    it("refuses a correction that names no edit", async () => {
      await expect(
        caller.traceEditOverlay.upsert({
          projectId: PROJECT_ID,
          traceId: "trace-edit-overlay-empty",
          patch: { version: 1, spans: [], deletedSpanIds: [] },
        }),
      ).rejects.toThrow();

      expect(
        await prisma.traceEditOverlay.findUnique({
          where: {
            projectId_traceId: {
              projectId: PROJECT_ID,
              traceId: "trace-edit-overlay-empty",
            },
          },
        }),
      ).toBeNull();
    });

    /** @scenario "A correction that is not shaped like a trace is rejected" */
    it("refuses a span input that is not a captured value", async () => {
      await expect(
        caller.traceEditOverlay.upsert({
          projectId: PROJECT_ID,
          traceId: "trace-edit-overlay-malformed",
          patch: {
            version: 1,
            spans: [{ spanId: "span-1", input: { type: "nonsense", value: 1 } }],
            deletedSpanIds: [],
          } as unknown as TraceEditOverlayPatch,
        }),
      ).rejects.toThrow();

      expect(
        await prisma.traceEditOverlay.findUnique({
          where: {
            projectId_traceId: {
              projectId: PROJECT_ID,
              traceId: "trace-edit-overlay-malformed",
            },
          },
        }),
      ).toBeNull();
    });

    /** @scenario "Saving a correction without permission to update annotations is refused" */
    it("refuses a reviewer who may only view the project", async () => {
      await expect(
        viewer.traceEditOverlay.upsert({
          projectId: PROJECT_ID,
          traceId: "trace-edit-overlay-unauthorized",
          patch: renameSpanPatch("not allowed"),
        }),
      ).rejects.toThrow();

      expect(
        await prisma.traceEditOverlay.findUnique({
          where: {
            projectId_traceId: {
              projectId: PROJECT_ID,
              traceId: "trace-edit-overlay-unauthorized",
            },
          },
        }),
      ).toBeNull();
    });
  });

  describe("when a reviewer saves a correction", () => {
    /** @scenario "Saving a correction stores it with its author" */
    it("stores the correction with its author", async () => {
      const saved = await caller.traceEditOverlay.upsert({
        projectId: PROJECT_ID,
        traceId: TRACE_ID,
        patch: renameSpanPatch("cleaned up"),
      });

      expect(saved.patch.spans[0]?.name).toBe("cleaned up");
      expect(saved.createdBy?.id).toBe(authorId);

      const persisted = await prisma.traceEditOverlay.findUnique({
        where: {
          projectId_traceId: { projectId: PROJECT_ID, traceId: TRACE_ID },
        },
      });
      expect(persisted).not.toBeNull();
      expect(persisted!.createdById).toBe(authorId);
      expect(persisted!.id.startsWith("traceedit_")).toBe(true);
    });

    /** @scenario "Saving again replaces the correction and records the last editor" */
    it("replaces the patch and records the last editor", async () => {
      await caller.traceEditOverlay.upsert({
        projectId: PROJECT_ID,
        traceId: TRACE_ID,
        patch: renameSpanPatch("cleaned up"),
      });

      const replaced = await otherReviewer.traceEditOverlay.upsert({
        projectId: PROJECT_ID,
        traceId: TRACE_ID,
        patch: {
          version: 1,
          spans: [],
          deletedSpanIds: ["span-noise"],
        },
      });

      expect(replaced.patch.spans).toEqual([]);
      expect(replaced.patch.deletedSpanIds).toEqual(["span-noise"]);
      expect(replaced.createdBy?.id).toBe(authorId);
      expect(replaced.updatedBy?.id).toBe(otherReviewerId);

      expect(
        await prisma.traceEditOverlay.count({
          where: { projectId: PROJECT_ID, traceId: TRACE_ID },
        }),
      ).toBe(1);
    });

    /** @scenario "Saving a correction that changes trace metadata stores it" */
    it("stores corrected trace metadata alongside the span edits", async () => {
      const traceId = `${TRACE_ID_PREFIX}-metadata`;

      await caller.traceEditOverlay.upsert({
        projectId: PROJECT_ID,
        traceId,
        patch: {
          version: 1,
          trace: { metadata: { environment: "production", reviewer: null } },
          spans: [{ spanId: "span-1", name: "cleaned up" }],
          deletedSpanIds: [],
        },
      });

      const persisted = await prisma.traceEditOverlay.findUniqueOrThrow({
        where: { projectId_traceId: { projectId: PROJECT_ID, traceId } },
      });
      expect(persisted.patch).toMatchObject({
        trace: { metadata: { environment: "production", reviewer: null } },
        spans: [{ spanId: "span-1", name: "cleaned up" }],
      });
    });
  });

  describe("when a reviewer removes a correction", () => {
    /** @scenario "Removing a correction is idempotent and restores the original" */
    it("returns the trace to uncorrected and tolerates a second removal", async () => {
      await caller.traceEditOverlay.upsert({
        projectId: PROJECT_ID,
        traceId: "trace-edit-overlay-removable",
        patch: renameSpanPatch("cleaned up"),
      });

      await caller.traceEditOverlay.delete({
        projectId: PROJECT_ID,
        traceId: "trace-edit-overlay-removable",
      });
      await caller.traceEditOverlay.delete({
        projectId: PROJECT_ID,
        traceId: "trace-edit-overlay-removable",
      });

      expect(
        await caller.traceEditOverlay.getByTraceId({
          projectId: PROJECT_ID,
          traceId: "trace-edit-overlay-removable",
        }),
      ).toBeNull();
    });
  });

  describe("given a stored patch this build cannot interpret", () => {
    /** @scenario "A stored correction that can no longer be understood reads as none" */
    it("reads as no correction instead of failing", async () => {
      await prisma.traceEditOverlay.create({
        data: {
          id: "traceedit_corrupt_fixture",
          projectId: PROJECT_ID,
          traceId: "trace-edit-overlay-corrupt",
          patch: { version: 99, whatever: true },
        },
      });

      expect(
        await caller.traceEditOverlay.getByTraceId({
          projectId: PROJECT_ID,
          traceId: "trace-edit-overlay-corrupt",
        }),
      ).toBeNull();
    });
  });
});
