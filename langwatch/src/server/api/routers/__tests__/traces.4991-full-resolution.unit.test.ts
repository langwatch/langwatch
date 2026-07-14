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
// runs and writes an audit row via the `prisma` SINGLETON — not `ctx.prisma` —
// so overriding the context is not enough: the real client tries to open a
// Postgres connection the unit shard has no server for. That both fails the
// assertion and leaves a pending socket that keeps the vitest worker alive.
// Stub the audit function itself, matching translate/apiKey.myBindings/
// workflows.generateCommitMessage in this directory.
vi.mock("../../../auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
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
  // The thread read returns traces already sorted chronologically (the CH
  // service sorts before returning), so the fixture is sorted too — the router
  // relies on that order rather than re-deriving one.
  const previewTraces = [
    { trace_id: "t1", timestamps: { started_at: 100 } },
    { trace_id: "t2", timestamps: { started_at: 200 } },
    { trace_id: "t3", timestamps: { started_at: 300 } },
  ];

  /** Stands in for a de-offloaded value — anything the 64 KB preview is not. */
  const FULL_VALUE = "the full, de-offloaded conversation value";

  let publicCaller: ReturnType<typeof tracesRouter.createCaller>;
  /** Builds a caller whose ctx is an anonymous public-share reader. */
  function createPublicCaller({
    resourceId = "t2",
    threadId = null,
  }: {
    resourceId?: string;
    threadId?: string | null;
  } = {}) {
    const ctx = createInnerTRPCContext({
      session: null,
      req: undefined,
      res: undefined,
      permissionChecked: true,
      publiclyShared: true,
      shareGrant: {
        share_id: "share-1",
        project_id: "project_123",
        resource_type: "TRACE",
        resource_id: resourceId,
        thread_id: threadId,
      },
    });
    ctx.prisma = {} as unknown as PrismaClient;
    return tracesRouter.createCaller(ctx);
  }

  /** Reads thread-1 as the anonymous public-share caller. */
  function readThreadAsPublicCaller({
    traceId = "t2",
  }: {
    traceId?: string;
  } = {}) {
    return publicCaller.getTracesByThreadId({
      projectId: "project_123",
      threadId: "thread-1",
      traceId,
    });
  }

  beforeEach(() => {
    mockGetTracesByThreadId.mockResolvedValue(previewTraces);
    publicCaller = createPublicCaller();
  });

  describe("given the grant covers one trace in the thread", () => {
    beforeEach(() => {
      // The resolved value is distinguishable from the preview, so a test that
      // claims to return "fully-resolved" traces can actually tell them apart.
      mockGetTracesWithSpans.mockResolvedValue([
        {
          trace_id: "t2",
          timestamps: { started_at: 200 },
          output: { value: FULL_VALUE },
        },
      ]);
    });

    describe("when the public caller reads the thread", () => {
      it("reads the thread PREVIEW-only, never resolving blobs pre-authorization", async () => {
        await readThreadAsPublicCaller();

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
        await readThreadAsPublicCaller();

        // Not ["t1","t2","t3"] — the unauthorized siblings are never de-offloaded.
        expect(mockGetTracesWithSpans).toHaveBeenCalledWith(
          "project_123",
          ["t2"],
          expect.any(Object),
          undefined,
          { full: true },
        );
        // …and that is the ONLY resolution call. toHaveBeenCalledWith alone would
        // still pass if a second call leaked the unauthorized siblings through.
        expect(mockGetTracesWithSpans).toHaveBeenCalledTimes(1);
      });

      it("returns the FULL value, not the preview", async () => {
        const result = await readThreadAsPublicCaller();

        expect(result.map((t: { trace_id: string }) => t.trace_id)).toEqual([
          "t2",
        ]);
        expect(
          result.map((t: { output?: { value?: string } }) => t.output?.value),
        ).toEqual([FULL_VALUE]);
      });
    });
  });

  describe("given the grant covers the whole thread", () => {
    beforeEach(() => {
      publicCaller = createPublicCaller({ threadId: "thread-1" });
    });

    describe("when the public caller reads the thread", () => {
      it("resolves the thread directly with full IO", async () => {
        await readThreadAsPublicCaller();

        expect(mockGetTracesByThreadId).toHaveBeenCalledWith(
          "project_123",
          "thread-1",
          expect.any(Object),
          { full: true },
        );
        expect(mockGetTracesWithSpans).not.toHaveBeenCalled();
      });

      it("returns every trace in thread order", async () => {
        const result = await readThreadAsPublicCaller();

        expect(result).toEqual(previewTraces);
      });
    });
  });

  describe("given the granted trace is not in the requested thread", () => {
    beforeEach(() => {
      publicCaller = createPublicCaller({ resourceId: "missing" });
    });

    describe("when the public caller reads the thread", () => {
      it("returns empty and issues zero blob resolution", async () => {
        const result = await readThreadAsPublicCaller({ traceId: "missing" });

        expect(result).toEqual([]);
        expect(mockGetTracesWithSpans).not.toHaveBeenCalled();
        // Still preview-only on the way in — the thread was never de-offloaded
        // just to discover nothing in it was shared.
        expect(mockGetTracesByThreadId).toHaveBeenCalledWith(
          "project_123",
          "thread-1",
          expect.any(Object),
          { full: false },
        );
      });
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

  // A download returns trace-level input/output whether or not spans are
  // included, so gating resolveBlobs on includeSpans truncated any offloaded
  // trace in a spans-less download — the same bug fixed in ExportService for
  // summary-mode exports. Falsifiable: restore `resolveBlobs: input.includeSpans`
  // and this fails while the includeSpans:true case above still passes.
  describe("when getAllForDownload is called WITHOUT includeSpans", () => {
    it("still opts resolveBlobs in, so the download is not truncated", async () => {
      await caller.getAllForDownload({ ...baseFilters, includeSpans: false });
      expect(mockGetAllTracesForProject).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({
          downloadMode: true,
          includeSpans: false,
          resolveBlobs: true,
        }),
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
