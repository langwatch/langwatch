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

// `getAllForDownload` is a tRPC *mutation*, so the auditLogMutations middleware
// runs and writes an audit row. It reaches for the `prisma` SINGLETON exported by
// ~/server/db — not `ctx.prisma` — so overriding the context is not enough: the
// real client tries to open a Postgres connection the unit shard has no server
// for. That both fails the assertion and leaves a pending socket that keeps the
// vitest worker's event loop alive. Stub the singleton so the audit write is a
// no-op and this stays a true unit test of the router's call-site wiring.
vi.mock("~/server/db", () => ({
  prisma: { auditLog: { create: vi.fn().mockResolvedValue({}) } },
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
// AC2 (security) — public-share thread reads authorize BEFORE resolving blobs
//
// Regression guard for the #5082 review blocker: `getTracesByThreadId` is a
// publicProcedure. Resolving `{ full: true }` for the WHOLE thread before the
// publicShare filter narrows it lets one valid share link de-offload (and
// amplify unbounded event_log reads across) every other trace in that thread —
// traces the anonymous caller is not authorized to read.
//
// Falsifiable: restore the pre-fix "resolve full, then filter" order and the
// `{ full: false }` and `getTracesWithSpans(["t2"])` assertions below both fail.
// ---------------------------------------------------------------------------

describe("traces router — #4991 AC2 public-share thread read", () => {
  const previewTraces = [
    { trace_id: "t3", timestamps: { started_at: 300 } },
    { trace_id: "t1", timestamps: { started_at: 100 } },
    { trace_id: "t2", timestamps: { started_at: 200 } },
  ];

  let publicCaller: ReturnType<typeof tracesRouter.createCaller>;
  let mockFindMany: ReturnType<typeof vi.fn>;

  /** Builds a caller whose ctx is an anonymous public-share reader. */
  function createPublicCaller() {
    const ctx = createInnerTRPCContext({
      session: null,
      req: undefined,
      res: undefined,
      permissionChecked: true,
      publiclyShared: true,
    });
    ctx.prisma = {
      publicShare: { findMany: mockFindMany },
    } as unknown as PrismaClient;
    return tracesRouter.createCaller(ctx);
  }

  beforeEach(() => {
    mockFindMany = vi.fn();
    mockGetTracesByThreadId.mockResolvedValue(previewTraces);
    publicCaller = createPublicCaller();
  });

  describe("given only one trace in the thread is publicly shared", () => {
    beforeEach(() => {
      // Only t2 is shared; t1 and t3 are private siblings in the same thread.
      mockFindMany.mockResolvedValue([{ resourceId: "t2" }]);
      mockGetTracesWithSpans.mockResolvedValue([
        { trace_id: "t2", timestamps: { started_at: 200 } },
      ]);
    });

    it("reads the thread PREVIEW-only, never resolving blobs pre-authorization", async () => {
      await publicCaller.getTracesByThreadId({
        projectId: "project_123",
        threadId: "thread-1",
        traceId: "t2",
      });

      expect(mockGetTracesByThreadId).toHaveBeenCalledWith(
        "project_123",
        "thread-1",
        expect.any(Object),
        { full: false },
      );
      expect(mockGetTracesByThreadId).not.toHaveBeenCalledWith(
        "project_123",
        "thread-1",
        expect.any(Object),
        { full: true },
      );
    });

    it("resolves full IO for ONLY the authorized trace ids", async () => {
      await publicCaller.getTracesByThreadId({
        projectId: "project_123",
        threadId: "thread-1",
        traceId: "t2",
      });

      // Not ["t1","t2","t3"] — the unauthorized siblings are never de-offloaded.
      expect(mockGetTracesWithSpans).toHaveBeenCalledWith(
        "project_123",
        ["t2"],
        expect.any(Object),
        undefined,
        { full: true },
      );
    });

    it("returns the fully-resolved authorized traces", async () => {
      const result = await publicCaller.getTracesByThreadId({
        projectId: "project_123",
        threadId: "thread-1",
        traceId: "t2",
      });

      expect(result.map((t: { trace_id: string }) => t.trace_id)).toEqual([
        "t2",
      ]);
    });
  });

  describe("given several traces in the thread are publicly shared", () => {
    beforeEach(() => {
      mockFindMany.mockResolvedValue([
        { resourceId: "t1" },
        { resourceId: "t3" },
      ]);
      // Deliberately returned out of chronological order, as the underlying
      // trace-id-keyed bulk read does.
      mockGetTracesWithSpans.mockResolvedValue([
        { trace_id: "t3", timestamps: { started_at: 300 } },
        { trace_id: "t1", timestamps: { started_at: 100 } },
      ]);
    });

    it("returns them in chronological order", async () => {
      const result = await publicCaller.getTracesByThreadId({
        projectId: "project_123",
        threadId: "thread-1",
        traceId: "t1",
      });

      expect(result.map((t: { trace_id: string }) => t.trace_id)).toEqual([
        "t1",
        "t3",
      ]);
    });
  });

  describe("given no trace in the thread is publicly shared", () => {
    beforeEach(() => {
      mockFindMany.mockResolvedValue([]);
    });

    it("returns empty and issues zero blob resolution", async () => {
      const result = await publicCaller.getTracesByThreadId({
        projectId: "project_123",
        threadId: "thread-1",
        traceId: "t2",
      });

      expect(result).toEqual([]);
      expect(mockGetTracesWithSpans).not.toHaveBeenCalled();
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
