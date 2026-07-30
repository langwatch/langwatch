import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnnotationService } from "../../../annotations/annotation.service";
import { createInnerTRPCContext } from "../../trpc";
import { annotationRouter } from "../annotation";

const holder = vi.hoisted(() => ({ prisma: null as PrismaClient | null }));

vi.mock("../../../auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

// The router resolves the service off the composed app; the breadth guard under
// test sits in front of that, so a real service over the mock client is enough.
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    annotations: AnnotationService.create({ prisma: holder.prisma! }),
  }),
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    checkProjectPermission:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
  };
});

const queueItemUpsert = vi.fn();

const prisma = {
  project: {
    findUnique: vi
      .fn()
      .mockResolvedValue({ team: { organizationId: "org_1" } }),
  },
  organizationUser: { count: vi.fn().mockResolvedValue(1) },
  annotationScore: { count: vi.fn().mockResolvedValue(1) },
  annotationQueue: { count: vi.fn().mockResolvedValue(1) },
  annotationQueueItem: { upsert: queueItemUpsert },
} as unknown as PrismaClient;

holder.prisma = prisma;

const createCaller = () => {
  const ctx = createInnerTRPCContext({
    session: { user: { id: "creator_1" }, expires: "1" },
    permissionChecked: true,
  });
  ctx.prisma = prisma;
  return annotationRouter.createCaller(ctx);
};

const traceIds = (count: number) =>
  Array.from({ length: count }, (_, index) => `trace_${index}`);

describe("annotation.createQueueItem breadth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueItemUpsert.mockResolvedValue({ id: "item_1" });
  });

  describe("when the request names more traces than any page can select", () => {
    /** @scenario "An assignment far larger than any page of traces is rejected" */
    it("rejects it before writing a single queue item", async () => {
      await expect(
        createCaller().createQueueItem({
          projectId: "project_1",
          traceIds: traceIds(1001),
          annotators: ["queue-q1"],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      expect(queueItemUpsert).not.toHaveBeenCalled();
    });
  });

  describe("when the request names the largest page a reviewer can select", () => {
    it("accepts it", async () => {
      await createCaller().createQueueItem({
        projectId: "project_1",
        traceIds: traceIds(250),
        annotators: ["queue-q1"],
      });

      expect(queueItemUpsert).toHaveBeenCalledTimes(250);
    });
  });
});
