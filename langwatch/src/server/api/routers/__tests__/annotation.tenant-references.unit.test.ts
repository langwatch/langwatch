import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { annotationRouter, createOrUpdateQueueItems } from "../annotation";

vi.mock("../../../auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
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

const projectFindUnique = vi.fn();
const organizationUserCount = vi.fn();
const annotationScoreCount = vi.fn();
const annotationQueueCount = vi.fn();
const annotationQueueFindFirst = vi.fn();
const annotationQueueCreate = vi.fn();
const queueItemUpsert = vi.fn();

const prisma = {
  project: { findUnique: projectFindUnique },
  organizationUser: { count: organizationUserCount },
  annotationScore: { count: annotationScoreCount },
  annotationQueue: {
    count: annotationQueueCount,
    findFirst: annotationQueueFindFirst,
    create: annotationQueueCreate,
  },
  annotationQueueItem: { upsert: queueItemUpsert },
} as unknown as PrismaClient;

const queueInput = {
  projectId: "project_1",
  name: "Review queue",
  description: "",
  userIds: ["user_1"],
  scoreTypeIds: ["score_1"],
};

beforeEach(() => {
  vi.clearAllMocks();
  projectFindUnique.mockResolvedValue({
    team: { organizationId: "org_1" },
  });
  organizationUserCount.mockResolvedValue(1);
  annotationScoreCount.mockResolvedValue(1);
  annotationQueueCount.mockResolvedValue(1);
  annotationQueueFindFirst.mockResolvedValue(null);
  annotationQueueCreate.mockResolvedValue({ id: "queue_1" });
  queueItemUpsert.mockResolvedValue({ id: "item_1" });
});

const createCaller = () => {
  const ctx = createInnerTRPCContext({
    session: { user: { id: "creator_1" }, expires: "1" },
    permissionChecked: true,
  });
  ctx.prisma = prisma;
  return annotationRouter.createCaller(ctx);
};

describe("annotation queue references", () => {
  it("rejects queue members from another organization", async () => {
    organizationUserCount.mockResolvedValue(0);

    await expect(
      createCaller().createOrUpdateQueue(queueInput),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    expect(annotationQueueCreate).not.toHaveBeenCalled();
  });

  it("rejects annotation scores from another project", async () => {
    annotationScoreCount.mockResolvedValue(0);

    await expect(
      createCaller().createOrUpdateQueue(queueInput),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    expect(annotationQueueCreate).not.toHaveBeenCalled();
  });

  it("rejects queue assignments from another project", async () => {
    annotationQueueCount.mockResolvedValue(0);

    await expect(
      createOrUpdateQueueItems({
        traceIds: ["trace_1"],
        projectId: "project_1",
        annotators: ["queue-foreign-queue"],
        userId: "creator_1",
        prisma,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(queueItemUpsert).not.toHaveBeenCalled();
  });

  it("rejects user assignments from another organization", async () => {
    organizationUserCount.mockResolvedValue(0);

    await expect(
      createOrUpdateQueueItems({
        traceIds: ["trace_1"],
        projectId: "project_1",
        annotators: ["user-foreign-user"],
        userId: "creator_1",
        prisma,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(queueItemUpsert).not.toHaveBeenCalled();
  });

  it("keeps hyphens in validated annotator IDs", async () => {
    await createOrUpdateQueueItems({
      traceIds: ["trace_1"],
      projectId: "project_1",
      annotators: ["queue-queue-with-hyphens", "user-user-with-hyphens"],
      userId: "creator_1",
      prisma,
    });

    expect(queueItemUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          annotationQueueId: "queue-with-hyphens",
        }),
      }),
    );
    expect(queueItemUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId: "user-with-hyphens" }),
      }),
    );
  });
});
