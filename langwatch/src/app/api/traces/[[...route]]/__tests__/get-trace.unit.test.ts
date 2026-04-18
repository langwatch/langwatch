import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Evaluation, Trace } from "~/server/tracer/types";

// Mock TraceService to verify routing goes through it (not Elasticsearch directly)
const mockGetById = vi.fn();
const mockGetEvaluationsMultiple = vi.fn();

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

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
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

// Import app after mocks are defined
const { app: v1App } = await import("../app.v1");

// Build a wrapper app that injects the project variable (mimicking auth middleware)
// and adds an error handler that mirrors the real app's JSON error responses
const testApp = new Hono();
testApp.use("*", async (c, next) => {
  c.set("project" as never, { id: "project-123", apiKey: "key-123" });
  await next();
});
testApp.route("/", v1App);
testApp.onError((err, c) => {
  const status = "status" in err ? (err.status as number) : 500;
  return c.json({ message: err.message }, status as 404 | 500);
});

function makeRequest(
  traceId: string,
  query: Record<string, string> = {},
) {
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
    spans: [],
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
    it("uses TraceService.getById instead of Elasticsearch directly", async () => {
      const res = await makeRequest("trace-abc", { format: "json" });

      expect(res.status).toBe(200);
      expect(mockGetById).toHaveBeenCalledWith(
        "project-123",
        "trace-abc",
        expect.any(Object),
      );
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

    it("includes evaluations in the json response", async () => {
      const res = await makeRequest("trace-abc", { format: "json" });
      const body = await res.json();

      expect(body.evaluations).toEqual(sampleEvaluations);
    });

    it("includes evaluations in the digest response", async () => {
      const res = await makeRequest("trace-abc", { format: "digest" });
      const body = await res.json();

      expect(body.evaluations).toEqual(sampleEvaluations);
    });
  });

  describe("when trace is not found", () => {
    it("returns 404", async () => {
      mockGetById.mockResolvedValue(undefined);

      const res = await makeRequest("nonexistent");

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.message).toBe("Trace not found.");
    });
  });

  describe("when the caller passes a unique prefix", () => {
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
    it("returns 409 with the candidate trace IDs", async () => {
      const candidates = [
        "abc1230000000000000000000000aaaa",
        "abc1230000000000000000000000bbbb",
      ];
      // Use the real error class exported by the module-level mock
      const { AmbiguousTraceIdPrefixError } = await import(
        "~/server/traces/trace.service"
      );
      mockGetById.mockRejectedValue(
        new AmbiguousTraceIdPrefixError("abc123", candidates),
      );

      const res = await makeRequest("abc123");

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.message).toMatch(/ambiguous/i);
      expect(body.candidateTraceIds).toEqual(candidates);
    });
  });
});
