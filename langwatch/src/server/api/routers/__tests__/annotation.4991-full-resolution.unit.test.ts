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
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
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
  return {
    annotationQueueItem: {
      findMany: vi.fn().mockResolvedValue([queueItem]),
      count: vi.fn().mockResolvedValue(1),
    },
    annotation: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    annotationQueue: {
      findMany: vi.fn().mockResolvedValue([]),
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
  });
});
