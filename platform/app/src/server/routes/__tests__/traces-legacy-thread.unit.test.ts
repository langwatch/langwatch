/**
 * #4991 ("2 of 2" of #4888) — AC2 call-site wiring for the legacy thread route.
 *
 * GET /api/thread/:id returns a conversation's traces; the consumer reads the
 * messages, so it must resolve FULL IO, not the 64 KB preview. Proves the
 * handler uses the process-owned TraceService and calls getTracesByThreadId
 * with { full: true }. Mirrors the merged
 * traces-legacy-get-trace.unit.test.ts harness.
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceAppDependencies } from "@langwatch/trace-server";
import { appContextMiddlewareFor } from "~/app/api/middleware/app-context";
import { getApp } from "~/server/app-layer/app";
import { z } from "zod";
import type { Trace } from "@langwatch/trace-contract";

const mockGetTracesByThreadId = vi.fn();

const mockResolve = vi.fn();
const mockMarkUsed = vi.fn();

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

vi.mock("~/server/api/utils", () => ({
  getProtectionsForProject: vi.fn().mockResolvedValue({}),
}));

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("~/server/traces/trace-formatting", () => ({
  generateAsciiTree: vi.fn().mockReturnValue("ascii tree"),
  formatTraceSummaryDigest: vi.fn().mockReturnValue("Input: hi\nOutput: yo"),
  toLLMModeTrace: vi.fn().mockReturnValue({}),
}));

vi.mock("~/server/tracer/spanToReadableSpan", () => ({
  formatSpansDigest: vi.fn().mockReturnValue("formatted trace"),
}));

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
      share: { createShare: vi.fn(), unshare: vi.fn() },
      // The real `TraceApp` over the stubbed legacy read port. Resolving a
      // drawer read in full (`{ full: true }`, #4991) is the application's own
      // rule, and it is exactly what this suite asserts — a hand-written double
      // standing in its place would decide the answer instead of the code.
      traces: TraceApp.create({
        traces: { read: { getTracesByThreadId: mockGetTracesByThreadId } },
      } as unknown as TraceAppDependencies),
    })),
  };
});

vi.mock("~/server/api/ports/traces.schemas", () => ({
  getAllForProjectInput: z.object({
    projectId: z.string(),
    startDate: z.number(),
    endDate: z.number(),
    pageSize: z.number().optional(),
  }),
}));

const { app: legacyApp } = await import("../traces-legacy");

const testApp = new Hono();
testApp.use("*", appContextMiddlewareFor(getApp()));
testApp.route("/", legacyApp);

const sampleThreadTrace: Partial<Trace> = {
  trace_id: "trace-abc",
  project_id: "project-123",
  input: { value: "hello" },
  output: { value: "world" },
  timestamps: { started_at: 1000, inserted_at: 2000, updated_at: 2000 },
  metadata: { thread_id: "thread-1" },
  spans: [],
};

const fakeProject = {
  id: "project-123",
  apiKey: "test-token",
  team: { id: "team-1", organizationId: "org-1" },
};

function makeThreadRequest(threadId: string) {
  return testApp.request(`http://localhost/api/thread/${threadId}`, {
    method: "GET",
    headers: { "X-Auth-Token": "test-token" },
  });
}

describe("legacy GET /api/thread/:id — #4991 AC2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockResolvedValue({
      type: "legacyProjectKey",
      project: fakeProject,
    });
    mockGetTracesByThreadId.mockResolvedValue([sampleThreadTrace]);
  });

  describe("when fetching a thread by id", () => {
    it("uses the process-owned trace reader", async () => {
      await makeThreadRequest("thread-1");
      expect(mockGetTracesByThreadId).toHaveBeenCalledTimes(1);
    });

    it("calls getTracesByThreadId with full:true (resolves offloaded IO)", async () => {
      await makeThreadRequest("thread-1");
      expect(mockGetTracesByThreadId).toHaveBeenCalledWith(
        "project-123",
        "thread-1",
        expect.any(Object),
        { full: true },
      );
    });

    it("returns 200 with the thread traces", async () => {
      const res = await makeThreadRequest("thread-1");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.traces[0].trace_id).toBe("trace-abc");
    });
  });
});
