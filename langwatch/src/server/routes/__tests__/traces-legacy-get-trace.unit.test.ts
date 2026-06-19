import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Trace } from "~/server/tracer/types";

// ─── TraceService spy ─────────────────────────────────────────────────────────
// Capture at module scope so assertions can reach them from every it() block.
const mockGetById = vi.fn();
const mockGetEvaluationsMultiple = vi.fn();
const mockCreate = vi.fn();

vi.mock("~/server/traces/trace.service", async () => {
  class AmbiguousTraceIdPrefixError extends Error {
    constructor(
      public readonly prefix: string,
      public readonly candidateTraceIds: string[],
    ) {
      super(
        `Trace ID prefix "${prefix}" is ambiguous — matches: ${candidateTraceIds.join(", ")}`,
      );
      this.name = "AmbiguousTraceIdPrefixError";
    }
  }
  return {
    AmbiguousTraceIdPrefixError,
    TraceService: {
      create: mockCreate,
    },
  };
});

// ─── Blob-resolution deps spy ─────────────────────────────────────────────────
// Captured so we can assert create() received the return value of this function.
const mockBuildTraceBlobResolutionDeps = vi.fn(() => ({
  blobStore: { tag: "blobStore" },
  ioExtractionService: { tag: "ioExtractionService" },
}));

vi.mock("~/server/traces/trace-blob-resolution.deps", () => ({
  buildTraceBlobResolutionDeps: mockBuildTraceBlobResolutionDeps,
}));

// ─── Auth mocks ───────────────────────────────────────────────────────────────
// The legacy route creates a module-scope tokenResolver = TokenResolver.create(prisma).
// authenticateRequest() calls tokenResolver.resolve({token, projectId}) and
// tokenResolver.markUsed({apiKeyId}). Mock the class so the module-scope
// singleton uses a controllable mock.

const mockResolve = vi.fn();
const mockMarkUsed = vi.fn();

vi.mock("~/server/api-key/token-resolver", () => ({
  TokenResolver: {
    create: vi.fn(() => ({
      resolve: mockResolve,
      markUsed: mockMarkUsed,
    })),
  },
}));

// extractCredentials reads request headers; mock it to return a usable credential.
// enforceApiKeyCeiling enforces RBAC ceiling; mock it to be a no-op.
vi.mock("~/server/api-key/auth-middleware", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/server/api-key/auth-middleware")>();
  return {
    ...actual,
    extractCredentials: vi.fn(() => ({
      token: "test-token",
      projectId: "project-123",
    })),
    enforceApiKeyCeiling: vi.fn().mockResolvedValue(undefined),
  };
});

// ─── Infrastructure stubs ─────────────────────────────────────────────────────
vi.mock("~/server/api/utils", () => ({
  getProtectionsForProject: vi.fn().mockResolvedValue({}),
}));

vi.mock("~/server/db", () => ({
  prisma: {},
}));

// ─── Formatter stubs ──────────────────────────────────────────────────────────
vi.mock("~/server/traces/trace-formatting", () => ({
  generateAsciiTree: vi.fn().mockReturnValue("ascii tree"),
  formatTraceSummaryDigest: vi
    .fn()
    .mockReturnValue("Input: hello\nOutput: world"),
  toLLMModeTrace: vi.fn().mockReturnValue({}),
}));

vi.mock("~/server/tracer/spanToReadableSpan", () => ({
  formatSpansDigest: vi.fn().mockReturnValue("formatted trace"),
}));

// Stub the app-layer (used by share/unshare routes only; not needed for GET).
vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn(() => ({
    share: {
      createShare: vi.fn(),
      unshare: vi.fn(),
    },
  })),
}));

// Stub the schema used by the search route to avoid Zod import issues.
// Top-level `z` is safe to close over in a vi.mock factory — vitest hoists
// vi.mock calls but allows factories to reference imports of OTHER modules.
vi.mock("~/server/api/routers/traces.schemas", () => ({
  getAllForProjectInput: z.object({
    projectId: z.string(),
    startDate: z.number(),
    endDate: z.number(),
    pageSize: z.number().optional(),
  }),
}));

// ─── App under test ───────────────────────────────────────────────────────────
// Import AFTER all mocks so the module-scope `tokenResolver = TokenResolver.create(prisma)`
// picks up the mocked TokenResolver, and mockCreate is wired before any route runs.

const { app: legacyApp } = await import("../traces-legacy");

// The legacy app is mounted at basePath "/api" so requests must hit /api/trace/:id.
// Wrap in a thin Hono to allow test requests without a real HTTP server.
const testApp = new Hono();
testApp.route("/", legacyApp);

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const sampleTrace: Partial<Trace> = {
  trace_id: "trace-abc",
  project_id: "project-123",
  input: { value: "hello" },
  output: { value: "world" },
  timestamps: { started_at: 1000, inserted_at: 2000, updated_at: 2000 },
  metadata: { thread_id: "t1" },
  spans: [],
};

// The project object returned by tokenResolver.resolve — must match what
// authenticateRequest reads (resolved.project, resolved.type, resolved.apiKeyId).
const fakeProject = {
  id: "project-123",
  apiKey: "test-token",
  team: { id: "team-1", organizationId: "org-1" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeRequest(traceId: string, query: Record<string, string> = {}) {
  const searchParams = new URLSearchParams(query).toString();
  const url = `http://localhost/api/trace/${traceId}${searchParams ? `?${searchParams}` : ""}`;
  return testApp.request(url, {
    method: "GET",
    headers: {
      "X-Auth-Token": "test-token",
    },
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("legacy GET /api/trace/:id (singular)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Wire TokenResolver mock to return a valid legacyProjectKey resolution.
    mockResolve.mockResolvedValue({
      type: "legacyProjectKey",
      project: fakeProject,
    });

    // Wire TraceService.create to return the service mock.
    mockCreate.mockReturnValue({
      getById: mockGetById,
      getEvaluationsMultiple: mockGetEvaluationsMultiple,
    });

    mockGetById.mockResolvedValue(sampleTrace);
    mockGetEvaluationsMultiple.mockResolvedValue({
      "trace-abc": [],
    });
  });

  describe("when fetching a trace by id", () => {
    it("constructs TraceService with blob-resolution deps (mirrors the plural reference handler)", async () => {
      // PRE-FIX: FAILS — current code calls TraceService.create(prisma) with ONE arg,
      // not two. The fix must pass buildTraceBlobResolutionDeps() as the second arg.
      await makeRequest("trace-abc", { format: "json" });

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          blobStore: expect.anything(),
          ioExtractionService: expect.anything(),
        }),
      );
    });

    it("calls getById with full:true so >64 KB offloaded IO resolves (#4888)", async () => {
      // PRE-FIX: FAILS — current code calls traceService.getById(project.id, traceId, protections)
      // with THREE args; it must pass { full: true } as the fourth arg.
      await makeRequest("trace-abc", { format: "json" });

      expect(mockGetById).toHaveBeenCalledWith(
        "project-123",
        "trace-abc",
        expect.any(Object),
        { full: true },
      );
    });

    it("returns 200 with the trace json", async () => {
      // Sanity: the handler still returns the trace. Passes pre- and post-fix.
      const res = await makeRequest("trace-abc", { format: "json" });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.trace_id).toBe("trace-abc");
    });
  });
});
