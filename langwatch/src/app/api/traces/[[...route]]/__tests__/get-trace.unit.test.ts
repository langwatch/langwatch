import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Evaluation, Trace } from "~/server/tracer/types";

// Mock TraceService to verify routing goes through it (not Elasticsearch directly)
const mockGetById = vi.fn();
const mockGetEvaluationsMultiple = vi.fn();

vi.mock("~/server/traces/trace.service", () => ({
  TraceService: {
    create: () => ({
      getById: mockGetById,
      getEvaluationsMultiple: mockGetEvaluationsMultiple,
    }),
  },
}));

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
    timestamps: { started_at: 1000, inserted_at: 2000 },
    metadata: { thread_id: "t1" },
    spans: [],
  };

  const sampleEvaluations: Evaluation[] = [
    {
      evaluation_id: "eval-1",
      evaluator_id: "evaluator-1",
      trace_id: "trace-abc",
      project_id: "project-123",
      status: "processed",
      score: 0.9,
      passed: true,
      label: "good",
      timestamps: { started_at: 1000, finished_at: 2000, inserted_at: 2000 },
    } as Evaluation,
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
});
