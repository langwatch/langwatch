import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { TraceAppDependencies } from "@langwatch/trace-server";
import { appContextMiddlewareFor } from "~/app/api/middleware/app-context";
import { getApp } from "~/server/app-layer/app";
import type { Trace } from "@langwatch/trace-contract";

// Capture at module scope so assertions can reach them from every it() block.
const mockGetById = vi.fn();
const mockGetEvaluationsMultiple = vi.fn();

// ─── Auth mocks ───────────────────────────────────────────────────────────────
// The legacy route resolves credentials through the process App service.

const mockResolve = vi.fn();
const mockMarkUsed = vi.fn();

// extractCredentials reads request headers; mock it to return a usable credential.
// enforceApiKeyCeiling enforces RBAC ceiling; mock it to be a no-op.
vi.mock("~/server/api-key/auth-middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/api-key/auth-middleware")>();
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
  formatTraceSummaryDigest: vi.fn().mockReturnValue("Input: hello\nOutput: world"),
  toLLMModeTrace: vi.fn().mockReturnValue({}),
}));

vi.mock("~/server/tracer/spanToReadableSpan", () => ({
  formatSpansDigest: vi.fn().mockReturnValue("formatted trace"),
}));

// Stub the process App used by both the handler-managed auth and trace reader.
vi.mock("~/server/app-layer/app", async () => {
  const { TraceApp } = await import("@langwatch/trace-server");
  return {
    // Consumers that degrade without Redis read through this one.
    tryGetApp: () => null,
    getApp: vi.fn(() => ({
      // Resolving an inbound credential is the api-key SERVICE's job, and the
      // App hands that service out through `ApiKeyApp.apiKeyService` — the seam
      // every key-authenticated route reads on the way in.
      apiKeys: {
        apiKeyService: {
          tryResolveToken: mockResolve,
          markUsed: mockMarkUsed,
        },
      },
      share: {
        createShare: vi.fn(),
        unshare: vi.fn(),
      },
      evaluations: {},
      // The real `TraceApp` over the stubbed legacy read port. Resolving a
      // drawer read in full (`{ full: true }`, #4991) is the application's own
      // rule, and it is exactly what this suite asserts — a hand-written double
      // standing in its place would decide the answer instead of the code.
      traces: TraceApp.create({
        traces: {
          read: {
            getById: mockGetById,
            getEvaluationsMultiple: mockGetEvaluationsMultiple,
          },
        },
      } as unknown as TraceAppDependencies),
    })),
  };
});

// Stub the schema used by the search route to avoid Zod import issues.
// Top-level `z` is safe to close over in a vi.mock factory — vitest hoists
// vi.mock calls but allows factories to reference imports of OTHER modules.
vi.mock("~/server/api/ports/traces.schemas", () => ({
  getAllForProjectInput: z.object({
    projectId: z.string(),
    startDate: z.number(),
    endDate: z.number(),
    pageSize: z.number().optional(),
  }),
}));

// ─── App under test ───────────────────────────────────────────────────────────
// Import after the process App and transport dependencies are mocked.

const { app: legacyApp } = await import("../traces-legacy");

// The legacy app is mounted at basePath "/api" so requests must hit /api/trace/:id.
// Wrap in a thin Hono to allow test requests without a real HTTP server.
const testApp = new Hono();
testApp.use("*", appContextMiddlewareFor(getApp()));
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

// The project returned by the process App API Key service.
const fakeProject = {
  id: "project-123",
  apiKey: "test-token",
  team: { id: "team-1", organizationId: "org-1" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeRequest({ traceId, query = {} }: { traceId: string; query?: Record<string, string> }) {
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

    // Resolve a valid legacy project key through the process App service.
    mockResolve.mockResolvedValue({
      type: "legacyProjectKey",
      project: fakeProject,
    });

    mockGetById.mockResolvedValue(sampleTrace);
    mockGetEvaluationsMultiple.mockResolvedValue({
      "trace-abc": [],
    });
  });

  describe("when fetching a trace by id", () => {
    it("uses the process-owned trace reader", async () => {
      await makeRequest({ traceId: "trace-abc", query: { format: "json" } });

      expect(mockGetById).toHaveBeenCalledTimes(1);
    });

    it("calls getById with full:true so >64 KB offloaded IO resolves (#4888)", async () => {
      // PRE-FIX: FAILS — current code calls traceService.getById(project.id, traceId, protections)
      // with THREE args; it must pass { full: true } as the fourth arg.
      await makeRequest({ traceId: "trace-abc", query: { format: "json" } });

      expect(mockGetById).toHaveBeenCalledWith("project-123", "trace-abc", expect.any(Object), {
        full: true,
      });
    });

    it("returns 200 with the trace json", async () => {
      // Sanity: the handler still returns the trace. Passes pre- and post-fix.
      const res = await makeRequest({
        traceId: "trace-abc",
        query: { format: "json" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.trace_id).toBe("trace-abc");
    });
  });
});
