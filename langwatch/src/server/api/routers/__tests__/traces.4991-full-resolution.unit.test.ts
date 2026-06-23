/**
 * #4991 ("2 of 2" of #4888) — call-site wiring for the tRPC traces router.
 *
 * Proves each content-consuming bulk procedure constructs TraceService WITH
 * blob-resolution deps and opts into FULL resolution, while the list grid does
 * not (AC5). Mirrors the existing traces.getAllForProject.unit.test.ts harness
 * (createCaller + mocked TraceService + mocked rbac/utils).
 *
 *   AC1 — getAllForDownload passes resolveBlobs through the options.
 *   AC2 — getTracesByThreadId / getTracesWithSpansByThreadIds pass full:true.
 *   AC4 — getSampleTraces / getSampleTracesDataset pass full:true.
 *   AC5 — getAllForProject (list grid) constructs WITHOUT deps and never opts in.
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */

import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { tracesRouter } from "../traces";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockCreate,
  mockGetAllTracesForProject,
  mockGetTracesWithSpans,
  mockGetTracesByThreadId,
  mockGetTracesWithSpansByThreadIds,
  mockBuildDeps,
  BLOB_DEPS,
} = vi.hoisted(() => {
  const BLOB_DEPS = {
    blobStore: { tag: "blobStore" },
    ioExtractionService: { tag: "ioExtractionService" },
  };
  return {
    mockCreate: vi.fn(),
    mockGetAllTracesForProject: vi.fn(),
    mockGetTracesWithSpans: vi.fn(),
    mockGetTracesByThreadId: vi.fn(),
    mockGetTracesWithSpansByThreadIds: vi.fn(),
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

vi.mock("~/server/evaluations/evaluators", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    evaluatorsSchema: { keyof: () => ({ or: () => ({}) }) },
  };
});

vi.mock("~/server/evaluations/preconditions", () => ({
  evaluatePreconditions: vi.fn(() => true),
  buildPreconditionTraceDataFromTrace: vi.fn(() => ({})),
  checkEvaluatorRequiredFields: vi.fn(() => true),
}));

vi.mock("~/server/evaluations/types", () => ({
  checkPreconditionSchema: {},
}));

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const fakeService = {
  getAllTracesForProject: mockGetAllTracesForProject,
  getTracesWithSpans: mockGetTracesWithSpans,
  getTracesByThreadId: mockGetTracesByThreadId,
  getTracesWithSpansByThreadIds: mockGetTracesWithSpansByThreadIds,
};

const baseFilters = {
  projectId: "project_123",
  startDate: Date.now() - 86_400_000,
  endDate: Date.now(),
  filters: {},
};

let caller: ReturnType<typeof tracesRouter.createCaller>;

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockReturnValue(fakeService);
  mockBuildDeps.mockReturnValue(BLOB_DEPS);
  mockGetAllTracesForProject.mockResolvedValue({
    groups: [[{ trace_id: "t1" }]],
    totalHits: 1,
    traceChecks: {},
  });
  mockGetTracesWithSpans.mockResolvedValue([]);
  mockGetTracesByThreadId.mockResolvedValue([]);
  mockGetTracesWithSpansByThreadIds.mockResolvedValue([]);

  const ctx = createInnerTRPCContext({
    session: { user: { id: "test-user-id" }, expires: "1" },
    req: undefined,
    res: undefined,
    permissionChecked: true,
    publiclyShared: false,
  });
  ctx.prisma = {} as unknown as PrismaClient;
  caller = tracesRouter.createCaller(ctx);
});

/** Asserts the most recent TraceService.create call carried the blob deps. */
function expectConstructedWithBlobDeps() {
  expect(mockCreate).toHaveBeenCalledWith(expect.anything(), BLOB_DEPS);
}

// ---------------------------------------------------------------------------
// AC2 — thread reads
// ---------------------------------------------------------------------------

describe("traces router — #4991 AC2 thread reads", () => {
  describe("when getTracesByThreadId is called", () => {
    it("constructs TraceService with blob-resolution deps", async () => {
      await caller.getTracesByThreadId({
        projectId: "project_123",
        threadId: "thread-1",
        traceId: "trace-1",
      });
      expectConstructedWithBlobDeps();
    });

    it("requests full resolution (full:true)", async () => {
      await caller.getTracesByThreadId({
        projectId: "project_123",
        threadId: "thread-1",
        traceId: "trace-1",
      });
      expect(mockGetTracesByThreadId).toHaveBeenCalledWith(
        "project_123",
        "thread-1",
        expect.any(Object),
        { full: true },
      );
    });
  });

  describe("when getTracesWithSpansByThreadIds is called", () => {
    it("constructs with deps and requests full resolution", async () => {
      await caller.getTracesWithSpansByThreadIds({
        projectId: "project_123",
        threadIds: ["thread-1"],
      });
      expectConstructedWithBlobDeps();
      expect(mockGetTracesWithSpansByThreadIds).toHaveBeenCalledWith(
        "project_123",
        ["thread-1"],
        expect.any(Object),
        { full: true },
      );
    });
  });
});

// ---------------------------------------------------------------------------
// AC4 — dataset / sample builders
// ---------------------------------------------------------------------------

describe("traces router — #4991 AC4 dataset/sample builders", () => {
  describe("when getSampleTracesDataset is called", () => {
    it("constructs with deps and resolves spans full", async () => {
      await caller.getSampleTracesDataset(baseFilters);
      expectConstructedWithBlobDeps();
      expect(mockGetTracesWithSpans).toHaveBeenCalledWith(
        "project_123",
        ["t1"],
        expect.any(Object),
        expect.any(Object),
        { full: true },
      );
    });
  });

  describe("when getSampleTraces is called", () => {
    it("constructs with deps and resolves spans full", async () => {
      await caller.getSampleTraces({
        ...baseFilters,
        evaluatorType: "custom/foo",
        preconditions: [],
        expectedResults: 10,
      });
      expectConstructedWithBlobDeps();
      expect(mockGetTracesWithSpans).toHaveBeenCalledWith(
        "project_123",
        ["t1"],
        expect.any(Object),
        expect.any(Object),
        { full: true },
      );
    });
  });
});

// ---------------------------------------------------------------------------
// AC1 — export / download
// ---------------------------------------------------------------------------

describe("traces router — #4991 AC1 download", () => {
  describe("when getAllForDownload is called with includeSpans", () => {
    it("constructs with deps and opts resolveBlobs into the options", async () => {
      await caller.getAllForDownload({ ...baseFilters, includeSpans: true });
      expectConstructedWithBlobDeps();
      expect(mockGetAllTracesForProject).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({ downloadMode: true, resolveBlobs: true }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// AC5 — list grid stays preview-only
// ---------------------------------------------------------------------------

describe("traces router — #4991 AC5 list grid stays preview", () => {
  describe("when getAllForProject (list grid) is called", () => {
    it("constructs TraceService WITHOUT blob-resolution deps", async () => {
      await caller.getAllForProject(baseFilters);
      // Single positional arg (prisma) only — never the deps object.
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockBuildDeps).not.toHaveBeenCalled();
    });

    it("never opts resolveBlobs into the options", async () => {
      await caller.getAllForProject(baseFilters);
      expect(mockGetAllTracesForProject).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.not.objectContaining({ resolveBlobs: true }),
      );
    });
  });

  describe("when getFormattedSpansDigest (aggregation/digest) is called", () => {
    it("constructs WITHOUT deps and never requests full resolution", async () => {
      await caller.getFormattedSpansDigest({
        projectId: "project_123",
        traceIds: ["t1"],
      });
      expect(mockBuildDeps).not.toHaveBeenCalled();
      // getTracesWithSpans called with NO { full: true } opts (preview only).
      expect(mockGetTracesWithSpans).toHaveBeenCalledWith(
        "project_123",
        ["t1"],
        expect.any(Object),
      );
    });
  });
});
