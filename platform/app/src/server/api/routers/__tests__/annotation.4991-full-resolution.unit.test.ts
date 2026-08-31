/**
 * #4991 ("2 of 2" of #4888) — AC3 call-site wiring for the annotation router.
 *
 * Annotators label trace content, so the annotation-queue reads must resolve
 * the FULL IO value, not the 64 KB preview. Proves both queue-read sites
 * (getQueueItems inline + getOptimizedAnnotationQueues via the shared enrich
 * helper) use the process-owned reader and pass full:true.
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnnotationApp, PostgresAnnotationAdapter } from "@langwatch/annotation-server";
import { TraceApp } from "@langwatch/trace-server";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  createAnnotationTestOrganizations,
  createAnnotationTestProjects,
  createAnnotationTestUsers,
} from "~/test-utils/annotation-test-services";
import { createInnerTRPCContext } from "../../trpc";
import { appRouter } from "../../root";

const { mockGetTracesWithSpans } = vi.hoisted(() => ({
  mockGetTracesWithSpans: vi.fn(),
}));

const annotation = {
  id: "annotation-1",
  projectId: "project_123",
  traceId: "t1",
  userId: "annotation-user-1",
  email: "annotation@example.com",
  comment: "A comment",
  isThumbsUp: null,
  scoreOptions: {},
  expectedOutput: null,
  anchorKind: null,
  anchorId: null,
  anchorPath: null,
  createdAt: new Date(1),
  updatedAt: new Date(2),
};

const legacyFullUser = {
  id: "annotation-user-1",
  name: "Ada Lovelace",
  email: "annotation@example.com",
  emailVerified: true,
  image: "https://example.test/ada.png",
  pendingSsoSetup: false,
  createdAt: new Date(3),
  updatedAt: new Date(4),
  lastLoginAt: new Date(5),
  deactivatedAt: null,
  lastHomePath: "/traces",
  tracesExplorerTourDismissedAt: new Date(6),
};

const mockAnnotationFindMany = vi.fn().mockResolvedValue([annotation]);
const mockQueueItemFindMany = vi.fn();
const mockQueueItemCount = vi.fn().mockResolvedValue(1);

// The declared permission seam resolves its service from the App.
vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import("~/test-utils/appPermissionsMock");
  return appPermissionsMock();
});

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    hasProjectPermission: vi.fn(() => Promise.resolve(true)),
    resolveProjectPermission: vi
      .fn()
      .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
  };
});

vi.mock("../../utils", () => ({
  getUserProtectionsForProject: vi.fn().mockResolvedValue({
    canSeeCosts: true,
    canSeePiiData: true,
    canSeeTopics: true,
  }),
}));

// ---------------------------------------------------------------------------
// Prisma stub covering the annotation-queue read surfaces
// ---------------------------------------------------------------------------

function makePrismaStub(): PrismaClient {
  const queueItem = {
    id: "qi-1",
    traceId: "t1",
    annotationQueueId: null,
    user: null,
    createdByUser: null,
    annotationQueue: null,
  };
  mockQueueItemFindMany.mockResolvedValue([queueItem]);
  return {
    annotationQueueItem: {
      findMany: mockQueueItemFindMany,
      count: mockQueueItemCount,
    },
    annotation: {
      findMany: mockAnnotationFindMany,
    },
    annotationQueue: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaClient;
}

let caller: ReturnType<typeof appRouter.createCaller>["annotation"];
let users = createAnnotationTestUsers();

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTracesWithSpans.mockResolvedValue([]);
  mockAnnotationFindMany.mockResolvedValue([annotation]);
  users = createAnnotationTestUsers();
  users.getProfiles.mockResolvedValue([legacyFullUser]);

  const ctx = createInnerTRPCContext({
    session: { user: { id: "test-user-id" }, expires: "1" },
    req: undefined,
    res: undefined,
    permissionChecked: true,
    publiclyShared: false,
  });
  ctx.prisma = makePrismaStub();
  Object.assign(ctx.app, {
    // `app.annotations` is an `AnnotationApp` in the real composition, not the
    // service it wraps: the join between a comment and the person who left it
    // is the application's, and the transport reads it there
    // (`listWithFullUsers`, `listWithUserSummaries`, `organizationOf`).
    annotations: AnnotationApp.create({
      annotations: PostgresAnnotationAdapter.create({
        database: ctx.prisma,
        // The organization a project belongs to is the project service's
        // answer, not a Prisma row this suite stubs.
        projects: createAnnotationTestProjects("org_123"),
        organizations: createAnnotationTestOrganizations(),
      }).build(),
      users,
    }),
    users,
    // The real `TraceApp` over a stubbed legacy reader, because `full: true`
    // — the whole subject of #4991 — is the application's own decision now,
    // not the caller's. A hand-written `readTracesWithSpans` double here
    // would assert the flag this file exists to pin from the test's own side.
    traces: TraceApp.create({
      traces: { read: { getTracesWithSpans: mockGetTracesWithSpans } },
    } as never),
  });
  caller = appRouter.createCaller(ctx).annotation;
});

function expectFullResolution() {
  expect(mockGetTracesWithSpans).toHaveBeenCalledWith(
    "project_123",
    ["t1"],
    expect.any(Object),
    undefined,
    { full: true },
  );
}

describe("annotation router — #4991 AC3 annotation-queue reads", () => {
  describe("when getQueueItems is called", () => {
    it("uses the process-owned reader and resolves trace IO full", async () => {
      await caller.getQueueItems({ projectId: "project_123" });
      expectFullResolution();
      expect(mockQueueItemFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: "project_123",
            AND: expect.arrayContaining([
              {
                OR: [
                  { annotationQueueId: null },
                  { annotationQueue: { projectId: "project_123" } },
                ],
              },
              {
                OR: [
                  { userId: null },
                  {
                    user: {
                      orgMemberships: {
                        some: { organizationId: "org_123" },
                      },
                    },
                  },
                ],
              },
            ]),
          }),
        }),
      );
    });
  });

  describe("when getOptimizedAnnotationQueues is called (shared enrich helper)", () => {
    it("uses the process-owned reader and resolves trace IO full", async () => {
      await caller.getOptimizedAnnotationQueues({
        projectId: "project_123",
        selectedAnnotations: "pending",
        pageSize: 10,
        pageOffset: 0,
      });
      expectFullResolution();
    });

    it("scopes an explicit queue to the project", async () => {
      await caller.getOptimizedAnnotationQueues({
        projectId: "project_123",
        selectedAnnotations: "pending",
        pageSize: 10,
        pageOffset: 0,
        queueId: "queue_123",
      });

      expect(mockQueueItemCount).toHaveBeenCalledWith({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              annotationQueue: {
                id: "queue_123",
                projectId: "project_123",
              },
            },
          ]),
        }),
      });
    });
  });
});

describe("annotation router user response projections", () => {
  it("keeps the trace read's narrow user projection", async () => {
    const result = await caller.getByTraceId({
      projectId: "project_123",
      traceId: "t1",
    });

    expect(users.getProfiles).toHaveBeenCalledWith({ userIds: ["annotation-user-1"] });
    expect(result[0]?.user).toEqual({
      id: "annotation-user-1",
      name: "Ada Lovelace",
      image: "https://example.test/ada.png",
    });
  });

  it("keeps every legacy User scalar on the project annotation list", async () => {
    const result = await caller.getAll({ projectId: "project_123" });

    expect(result[0]?.user).toEqual(legacyFullUser);
  });

  it("keeps every legacy User scalar when enriching queue annotations", async () => {
    const result = await caller.getOptimizedAnnotationQueues({
      projectId: "project_123",
      selectedAnnotations: "pending",
      pageSize: 10,
      pageOffset: 0,
    });

    expect(result.assignedQueueItems[0]?.annotations[0]?.user).toEqual(legacyFullUser);
  });
});
