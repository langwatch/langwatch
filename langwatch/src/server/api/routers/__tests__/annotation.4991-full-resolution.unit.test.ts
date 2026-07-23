/**
 * #4991 ("2 of 2" of #4888) — AC3 call-site wiring for the annotation router.
 *
 * Annotators label trace content, so the annotation-queue reads must resolve
 * the FULL IO value, not the 64 KB preview. Proves both queue-read sites
 * (getQueueItems inline + getOptimizedAnnotationQueues via the shared enrich
 * helper) construct TraceService WITH blob-resolution deps and pass full:true.
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */

import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { annotationRouter } from "../annotation";

const { mockCreate, mockGetTracesWithSpans, mockBuildDeps, BLOB_DEPS } =
  vi.hoisted(() => {
    const BLOB_DEPS = {
      blobStore: { tag: "blobStore" },
      ioExtractionService: { tag: "ioExtractionService" },
    };
    return {
      mockCreate: vi.fn(),
      mockGetTracesWithSpans: vi.fn(),
      mockBuildDeps: vi.fn(() => BLOB_DEPS),
      BLOB_DEPS,
    };
  });

const mockAnnotationFindMany = vi.fn().mockResolvedValue([]);
const mockQueueItemFindMany = vi.fn();
const mockQueueItemCount = vi.fn().mockResolvedValue(1);

vi.mock("~/server/traces/trace.service", () => ({
  TraceService: { create: mockCreate },
}));

vi.mock("~/server/traces/trace-blob-resolution.deps", () => ({
  buildTraceBlobResolutionDeps: mockBuildDeps,
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    hasProjectPermission: vi.fn(() => Promise.resolve(true)),
    checkProjectPermission:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
    checkPermissionOrPubliclyShared:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
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
    project: {
      findUnique: vi.fn().mockResolvedValue({
        team: { organizationId: "org_123" },
      }),
    },
  } as unknown as PrismaClient;
}

let caller: ReturnType<typeof annotationRouter.createCaller>;

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockReturnValue({ getTracesWithSpans: mockGetTracesWithSpans });
  mockBuildDeps.mockReturnValue(BLOB_DEPS);
  mockGetTracesWithSpans.mockResolvedValue([]);

  const ctx = createInnerTRPCContext({
    session: { user: { id: "test-user-id" }, expires: "1" },
    req: undefined,
    res: undefined,
    permissionChecked: true,
    publiclyShared: false,
  });
  ctx.prisma = makePrismaStub();
  caller = annotationRouter.createCaller(ctx);
});

function expectFullResolution() {
  expect(mockCreate).toHaveBeenCalledWith(expect.anything(), BLOB_DEPS);
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
    it("constructs with deps and resolves trace IO full", async () => {
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
    it("constructs with deps and resolves trace IO full", async () => {
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

describe("annotation router public reads", () => {
  it("only selects public profile fields for annotation users", async () => {
    await caller.getByTraceId({
      projectId: "project_123",
      traceId: "t1",
    });

    expect(mockAnnotationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
        },
      }),
    );
  });
});
