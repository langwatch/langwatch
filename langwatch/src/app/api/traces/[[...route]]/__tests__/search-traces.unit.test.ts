import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Trace } from "~/server/tracer/types";

const mockGetAllTracesForProject = vi.fn();

vi.mock("~/server/traces/trace.service", () => ({
  TraceService: {
    create: () => ({
      getAllTracesForProject: mockGetAllTracesForProject,
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
  formatSpansDigest: vi.fn().mockResolvedValue("full span digest"),
}));

vi.mock("~/server/traces/trace-formatting", () => ({
  generateAsciiTree: vi.fn().mockReturnValue("ascii tree"),
  formatTraceSummaryDigest: vi
    .fn()
    .mockReturnValue("Input: hello\nOutput: world"),
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

const { app: v1App } = await import("../app.v1");

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

function searchRequest(body: Record<string, unknown>) {
  return testApp.request("http://localhost/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /search", () => {
  const sampleTraces: Partial<Trace>[] = [
    {
      trace_id: "trace-1",
      project_id: "project-123",
      input: { value: "What is AI?" },
      output: { value: "AI is artificial intelligence." },
      timestamps: { started_at: 1000, inserted_at: 2000, updated_at: 2000 },
      metadata: {},
      spans: [],
    },
    {
      trace_id: "trace-2",
      project_id: "project-123",
      input: { value: "Hello" },
      output: { value: "Hi there" },
      timestamps: { started_at: 3000, inserted_at: 4000, updated_at: 4000 },
      metadata: {},
      spans: [],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllTracesForProject.mockResolvedValue({
      groups: [sampleTraces],
      totalHits: 2,
      scrollId: undefined,
    });
  });

  describe("when format is digest", () => {
    it("passes includeSpans as false by default", async () => {
      await searchRequest({
        startDate: 1000,
        endDate: 5000,
        format: "digest",
      });

      const options = mockGetAllTracesForProject.mock.calls[0]![2];
      expect(options.includeSpans).toBe(false);
    });

    it("returns compact summary digests instead of full span content", async () => {
      const res = await searchRequest({
        startDate: 1000,
        endDate: 5000,
        format: "digest",
      });

      const body = await res.json();
      expect(body.traces).toHaveLength(2);
      expect(body.traces[0].formatted_trace).toBe(
        "Input: hello\nOutput: world"
      );
    });

    it("includes trace metadata in each digest entry", async () => {
      const res = await searchRequest({
        startDate: 1000,
        endDate: 5000,
        format: "digest",
      });

      const body = await res.json();
      const first = body.traces[0];
      expect(first).toHaveProperty("trace_id", "trace-1");
      expect(first).toHaveProperty("input");
      expect(first).toHaveProperty("output");
      expect(first).toHaveProperty("timestamps");
      expect(first).toHaveProperty("metadata");
    });
  });

  describe("when includeSpans is true", () => {
    it("passes includeSpans true to the trace service", async () => {
      await searchRequest({
        startDate: 1000,
        endDate: 5000,
        format: "json",
        includeSpans: true,
      });

      const options = mockGetAllTracesForProject.mock.calls[0]![2];
      expect(options.includeSpans).toBe(true);
    });
  });

  describe("when format is json", () => {
    it("returns raw trace data", async () => {
      const res = await searchRequest({
        startDate: 1000,
        endDate: 5000,
        format: "json",
      });

      const body = await res.json();
      expect(body.traces).toHaveLength(2);
      expect(body.traces[0]).toHaveProperty("trace_id", "trace-1");
      expect(body.traces[0]).not.toHaveProperty("formatted_trace");
    });
  });

  describe("when format defaults via llmMode", () => {
    it("uses digest format when llmMode is true", async () => {
      const res = await searchRequest({
        startDate: 1000,
        endDate: 5000,
        llmMode: true,
      });

      const body = await res.json();
      expect(body.traces[0]).toHaveProperty("formatted_trace");
    });
  });
});
