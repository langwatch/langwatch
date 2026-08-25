import { PostgresAnnotationAdapter } from "@langwatch/annotation-server";
import { UserNotInOrganizationError } from "@langwatch/organization-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  createAnnotationTestOrganizations,
  createAnnotationTestProjects,
  createAnnotationTestUsers,
} from "~/test-utils/annotation-test-services";
import { createInnerTRPCContext } from "../../trpc";
import { annotationRouter, createOrUpdateQueueItems } from "../annotation";

// The declared permission seam resolves its service from the App.
vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import("~/test-utils/appPermissionsMock");
  return appPermissionsMock();
});

vi.mock("~/runtime/app/features/audit-log", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    resolveProjectPermission: vi
      .fn()
      .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
  };
});

const annotationScoreCount = vi.fn();
const annotationQueueCount = vi.fn();
const annotationQueueFindFirst = vi.fn();
const annotationQueueCreate = vi.fn();
const annotationFindFirst = vi.fn();
const annotationUpdate = vi.fn();
type QueueItem = {
  annotationQueueId?: string;
  createdByUserId: string;
  doneAt: Date | null;
  projectId: string;
  traceId: string;
  userId?: string;
};

const queueItemState = new Map<string, QueueItem>();
const queueItemKey = (item: QueueItem) =>
  `${item.projectId}:${item.traceId}:${item.annotationQueueId ?? item.userId ?? ""}`;
const queueItemCreateMany = vi.fn(async ({ data }: { data: QueueItem[] }) => {
  for (const item of data) {
    const key = queueItemKey(item);
    if (!queueItemState.has(key)) queueItemState.set(key, { ...item, doneAt: null });
  }
  return { count: data.length };
});
const queueItemUpdateMany = vi.fn(
  async ({
    where,
    data,
  }: {
    where: {
      annotationQueueId?: { in: string[] };
      projectId: string;
      traceId: { in: string[] };
      userId?: { in: string[] };
    };
    data: { doneAt: null };
  }) => {
    let count = 0;
    for (const item of queueItemState.values()) {
      const queueMatches =
        where.annotationQueueId === void 0 ||
        where.annotationQueueId.in.includes(item.annotationQueueId ?? "");
      const userMatches =
        where.userId === void 0 || where.userId.in.includes(item.userId ?? "");
      if (
        item.projectId === where.projectId &&
        where.traceId.in.includes(item.traceId) &&
        queueMatches &&
        userMatches
      ) {
        item.doneAt = data.doneAt;
        count += 1;
      }
    }
    return { count };
  },
);
const queueItemTransaction = vi.fn(async (callback: (transaction: unknown) => unknown) =>
  callback({
    annotationQueueItem: {
      createMany: queueItemCreateMany,
      updateMany: queueItemUpdateMany,
    },
  }),
);
const projects = createAnnotationTestProjects("org_1");
const organizations = createAnnotationTestOrganizations();
const users = createAnnotationTestUsers();

const prisma = {
  $transaction: queueItemTransaction,
  annotationScore: { count: annotationScoreCount },
  annotation: {
    findFirst: annotationFindFirst,
    update: annotationUpdate,
  },
  annotationQueue: {
    count: annotationQueueCount,
    findFirst: annotationQueueFindFirst,
    create: annotationQueueCreate,
  },
  annotationQueueItem: {
    createMany: queueItemCreateMany,
    updateMany: queueItemUpdateMany,
  },
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
  annotationScoreCount.mockResolvedValue(1);
  annotationQueueCount.mockResolvedValue(1);
  annotationQueueFindFirst.mockResolvedValue(null);
  annotationQueueCreate.mockResolvedValue({ id: "queue_1" });
  annotationFindFirst.mockResolvedValue(null);
  queueItemState.clear();
});

const createCaller = () => {
  const ctx = createInnerTRPCContext({
    session: { user: { id: "creator_1" }, expires: "1" },
    permissionChecked: true,
  });
  ctx.prisma = prisma;
  Object.assign(ctx.app, {
    annotations: PostgresAnnotationAdapter.create({
      database: prisma,
      projects,
      organizations,
    }).build(),
    users,
  });
  return annotationRouter.createCaller(ctx);
};

const annotationService = () =>
  PostgresAnnotationAdapter.create({ database: prisma, projects, organizations }).build();

describe("annotation queue references", () => {
  it("keeps the legacy internal error when an update target is absent", async () => {
    annotationUpdate.mockRejectedValueOnce(new Error("Record to update not found."));

    await expect(
      createCaller().updateByTraceId({
        id: "missing-annotation",
        projectId: "project_1",
        traceId: "trace_1",
        comment: "updated",
        scoreOptions: {},
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });

    expect(annotationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "missing-annotation", projectId: "project_1" },
      }),
    );
    expect(annotationUpdate).toHaveBeenCalledOnce();
  });

  it("rejects queue members from another organization", async () => {
    organizations.getOrganizationMembers.mockRejectedValueOnce(
      new UserNotInOrganizationError("user_1"),
    );

    await expect(createCaller().createOrUpdateQueue(queueInput)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    expect(organizations.getOrganizationMembers).toHaveBeenCalledWith({
      organizationId: "org_1",
      userIds: ["user_1"],
    });
    expect(annotationQueueCreate).not.toHaveBeenCalled();
  });

  it("rejects annotation scores from another project", async () => {
    annotationScoreCount.mockResolvedValue(0);

    await expect(createCaller().createOrUpdateQueue(queueInput)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    expect(annotationScoreCount).toHaveBeenCalledWith({
      where: { projectId: "project_1", id: { in: ["score_1"] } },
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
        annotations: annotationService(),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(annotationQueueCount).toHaveBeenCalledWith({
      where: { id: { in: ["foreign-queue"] }, projectId: "project_1" },
    });
    expect(queueItemCreateMany).not.toHaveBeenCalled();
  });

  it("rejects user assignments from another organization", async () => {
    organizations.getOrganizationMembers.mockRejectedValueOnce(
      new UserNotInOrganizationError("foreign-user"),
    );

    await expect(
      createOrUpdateQueueItems({
        traceIds: ["trace_1"],
        projectId: "project_1",
        annotators: ["user-foreign-user"],
        userId: "creator_1",
        prisma,
        annotations: annotationService(),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(organizations.getOrganizationMembers).toHaveBeenCalledWith({
      organizationId: "org_1",
      userIds: ["foreign-user"],
    });
    expect(queueItemCreateMany).not.toHaveBeenCalled();
  });

  it("keeps hyphens in validated annotator IDs", async () => {
    await createOrUpdateQueueItems({
      traceIds: ["trace_1"],
      projectId: "project_1",
      annotators: ["queue-queue-with-hyphens", "user-user-with-hyphens"],
      userId: "creator_1",
      prisma,
      annotations: annotationService(),
      // Which ids resolve to a trace is ClickHouse's answer; this file is about
      // which annotators the references are allowed to name.
      findExistingTraceIds: async ({ traceIds }) => traceIds,
    });

    expect([...queueItemState.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ annotationQueueId: "queue-with-hyphens" }),
        expect.objectContaining({ userId: "user-with-hyphens" }),
      ]),
    );
    expect(queueItemTransaction).toHaveBeenCalledTimes(1);
  });

  it("requeues an existing item without changing its creator", async () => {
    queueItemState.set("project_1:trace_1:user-user_1", {
      projectId: "project_1",
      traceId: "trace_1",
      userId: "user_1",
      createdByUserId: "first-creator",
      doneAt: new Date(1),
    });

    await createOrUpdateQueueItems({
      traceIds: ["trace_1"],
      projectId: "project_1",
      annotators: ["user-user_1"],
      userId: "next-creator",
      prisma,
      annotations: annotationService(),
      findExistingTraceIds: async ({ traceIds }) => traceIds,
    });

    expect(queueItemState.get("project_1:trace_1:user-user_1")).toEqual({
      projectId: "project_1",
      traceId: "trace_1",
      userId: "user_1",
      createdByUserId: "first-creator",
      doneAt: null,
    });
  });
});
