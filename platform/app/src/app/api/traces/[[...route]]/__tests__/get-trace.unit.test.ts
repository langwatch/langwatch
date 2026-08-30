import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Evaluation, Trace } from "@langwatch/trace-contract";
import { appContextMiddlewareFor } from "~/app/api/middleware/app-context";
import { getApp } from "~/server/app-layer/app";

// Mock TraceService to verify routing goes through it
const mockGetById = vi.fn();
const mockGetEvaluationsMultiple = vi.fn();

vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn(() => ({
    // The routes read `c.app.traceRead`, which `App` hoisted to a top-level
    // field from `deps.traces.read`. Mocking the old nested shape left
    // `c.app.traceRead` undefined, so every case here 500'd on the route
    // rather than on anything it was asserting.
    traceRead: {
      getById: mockGetById,
      getEvaluationsMultiple: mockGetEvaluationsMultiple,
    },
  })),
}));

vi.mock("~/server/traces/trace.service", async () => {
  class AmbiguousTraceIdPrefixError extends Error {
    constructor(
      public readonly prefix: string,
      public readonly candidateTraceIds: string[],
    ) {
      super(`Trace ID prefix "${prefix}" is ambiguous — matches: ${candidateTraceIds.join(", ")}`);
      this.name = "AmbiguousTraceIdPrefixError";
    }
  }
  return {
    AmbiguousTraceIdPrefixError,
    TraceService: {
      create: () => ({
        getById: mockGetById,
        getEvaluationsMultiple: mockGetEvaluationsMultiple,
      }),
    },
  };
});

vi.mock("~/server/api/utils", () => ({
  getProtectionsForProject: vi.fn().mockResolvedValue({}),
}));

vi.mock("~/server/db", () => ({
  prisma: {},
}));

vi.mock("~/server/tracer/spanToReadableSpan", () => ({
  formatSpansDigest: vi.fn().mockResolvedValue("formatted trace"),
}));

vi.mock("~/server/traces/trace-formatting", () => ({
  generateAsciiTree: vi.fn().mockReturnValue("ascii tree"),
  formatTraceSummaryDigest: vi.fn().mockReturnValue("Input: hello\nOutput: world"),
}));

vi.mock("~/app/api/shared/platform-url", () => ({
  platformUrl: vi.fn(({ path }: { path: string }) => `https://app.langwatch.ai/project${path}`),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("~/server/api/routers/traces.schemas", () => {
  const { z } = require("zod");
  return {
    getAllForProjectInput: z.object({
      projectId: z.string(),
      startDate: z.number(),
      endDate: z.number(),
      pageSize: z.number().optional(),
    }),
  };
});

// The routes are registered through the SecuredApp builder, whose project
// strategy runs the real authMiddleware. Mock it to a passthrough so these
// unit tests exercise the handler logic with an injected project, not real auth.
vi.mock("~/app/api/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/app/api/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: { set: (k: string, v: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("project", { id: "project-123", apiKey: "key-123" });
      await next();
    },
    requirePermission: () => async (_c: unknown, next: () => Promise<void>) => next(),
  };
});

// Import app after mocks are defined. Build the v1 routes onto a secured app
// rooted at "/" so the request paths in this suite stay unprefixed.
const { registerTracesRoutes } = await import("../app.v1");
const { createProjectApp } = await import("~/server/api/security");
const securedTest = createProjectApp({ basePath: "/" });
registerTracesRoutes(securedTest);
const v1App = securedTest.hono;
const { AmbiguousTraceIdPrefixError } = await import("~/server/traces/trace.service");

// Build a wrapper app that injects the project variable (mimicking auth middleware)
// and adds an error handler that mirrors the real app's JSON error responses
const testApp = new Hono();
testApp.use("*", appContextMiddlewareFor(getApp()));
testApp.route("/", v1App);
testApp.onError((err, c) => {
  const status = "status" in err ? (err.status as number) : 500;
  return c.json({ message: err.message }, status as 404 | 500);
});

function makeRequest(traceId: string, query: Record<string, string> = {}) {
  const searchParams = new URLSearchParams(query).toString();
  const url = `http://localhost/${traceId}${searchParams ? `?${searchParams}` : ""}`;

  return testApp.request(url, { method: "GET" });
}

describe("GET /:traceId", () => {
  const sampleTrace: Partial<Trace> = {
    trace_id: "trace-abc",
    project_id: "project-123",
    input: { value: "hello" },
    output: { value: "world" },
    timestamps: { started_at: 1000, inserted_at: 2000, updated_at: 2000 },
    metadata: { thread_id: "t1" },
    privacy: { droppedCategories: ["input"] },
    contexts: [{ document_id: "doc-1", chunk_id: "chunk-1", content: "context" }],
    expected_output: { value: "expected" },
    metrics: {
      first_token_ms: 12,
      total_time_ms: 34,
      prompt_tokens: 10,
      completion_tokens: 20,
      reasoning_tokens: 5,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 2,
      cache_creation_5m_input_tokens: 1,
      cache_creation_1h_input_tokens: 1,
      context_size_tokens: 40,
      total_cost: 0.01,
      tokens_estimated: false,
    },
    error: { has_error: true, message: "failed", stacktrace: ["line 1"] },
    indexing_md5s: ["md5"],
    events: [
      {
        event_id: "event-1",
        event_type: "feedback",
        project_id: "project-123",
        metrics: { score: 1 },
        event_details: { source: "test" },
        trace_id: "trace-abc",
        timestamps: { started_at: 1000, inserted_at: 2000, updated_at: 2000 },
      },
    ],
    spans: [],
    redacted_by_visibility_window: true,
  };

  const sampleEvaluations: Evaluation[] = [
    {
      evaluation_id: "eval-1",
      evaluator_id: "evaluator-1",
      name: "test-evaluator",
      status: "processed",
      score: 0.9,
      passed: true,
      label: "good",
      timestamps: { started_at: 1000, finished_at: 2000, inserted_at: 2000 },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetById.mockResolvedValue(sampleTrace);
    mockGetEvaluationsMultiple.mockResolvedValue({
      "trace-abc": sampleEvaluations,
    });
  });

  describe("when fetching a trace", () => {
    /** @scenario Full trace ID resolves exactly */
    it("uses TraceService.getById instead of Elasticsearch directly", async () => {
      const res = await makeRequest("trace-abc", { format: "json" });

      expect(res.status).toBe(200);
      expect(mockGetById).toHaveBeenCalledWith("project-123", "trace-abc", expect.any(Object), {
        full: true,
      });
    });

    it("fetches evaluations via TraceService.getEvaluationsMultiple", async () => {
      const res = await makeRequest("trace-abc", { format: "json" });

      expect(res.status).toBe(200);
      expect(mockGetEvaluationsMultiple).toHaveBeenCalledWith(
        "project-123",
        ["trace-abc"],
        expect.any(Object),
      );
    });

    it("preserves the complete json response envelope", async () => {
      const res = await makeRequest("trace-abc", { format: "json" });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(body).toEqual({
        ...sampleTrace,
        evaluations: sampleEvaluations,
        ascii_tree: "ascii tree",
        platformUrl: "https://app.langwatch.ai/project/traces/trace-abc",
      });
    });

    it("preserves the complete digest response envelope", async () => {
      const res = await makeRequest("trace-abc", { format: "digest" });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(body).toEqual({
        trace_id: "trace-abc",
        formatted_trace: "formatted trace",
        timestamps: sampleTrace.timestamps,
        metadata: sampleTrace.metadata,
        evaluations: sampleEvaluations,
        platformUrl: "https://app.langwatch.ai/project/traces/trace-abc",
      });
    });
  });

  describe("when trace is not found", () => {
    /** @scenario No match returns 404 */
    /** @scenario Too-short prefix falls through to 404 */
    /** @scenario Non-hex input skips prefix scan and returns 404 */
    it("returns 404", async () => {
      mockGetById.mockResolvedValue(undefined);

      const res = await makeRequest("nonexistent");

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.message).toBe("Trace not found.");
    });
  });

  describe("when the caller passes a unique prefix", () => {
    /** @scenario Unique prefix resolves to the full trace */
    /** @scenario CLI `trace get` with truncated ID from `trace search` succeeds */
    it("returns the trace using the resolved full trace ID", async () => {
      // Service resolves the prefix and hands back the full trace
      const fullId = "63dc535cea6335c506bc81ef3543a07d";
      mockGetById.mockResolvedValue({ ...sampleTrace, trace_id: fullId });
      mockGetEvaluationsMultiple.mockResolvedValue({
        [fullId]: sampleEvaluations,
      });

      const res = await makeRequest("63dc535cea6335c506bc", {
        format: "json",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.trace_id).toBe(fullId);
      expect(body.platformUrl).toContain(fullId);
      // Evaluations lookup keys on the FULL trace ID, not the prefix
      expect(mockGetEvaluationsMultiple).toHaveBeenCalledWith(
        "project-123",
        [fullId],
        expect.any(Object),
      );
    });
  });

  describe("when the prefix matches multiple traces", () => {
    /** @scenario Ambiguous prefix returns 409 with the matching IDs */
    it("returns 409 with the candidate trace IDs", async () => {
      const candidates = ["abc1230000000000000000000000aaaa", "abc1230000000000000000000000bbbb"];
      mockGetById.mockRejectedValue(new AmbiguousTraceIdPrefixError("abc12345", candidates));

      const res = await makeRequest("abc12345");

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.message).toMatch(/ambiguous/i);
      expect(body.candidateTraceIds).toEqual(candidates);
    });
  });
});
