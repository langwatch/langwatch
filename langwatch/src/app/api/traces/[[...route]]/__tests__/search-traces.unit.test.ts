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
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Partially mock the projection module: keep the real request schema + error
// class (so validation and the 400 path are exercised for real) and stub only
// `compileProjection` so these surface tests stay independent of the compiler
// implementation (owned separately). Each test drives the stub's behavior.
const mockCompileProjection = vi.fn();

vi.mock("~/server/traces/projection", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/server/traces/projection")>();
  return {
    ...actual,
    compileProjection: (args: unknown) => mockCompileProjection(args),
  };
});

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
  const actual =
    await importOriginal<typeof import("~/app/api/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: { set: (k: string, v: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("project", { id: "project-123", apiKey: "key-123" });
      await next();
    },
    requirePermission: () => async (_c: unknown, next: () => Promise<void>) =>
      next(),
  };
});

const { registerTracesRoutes } = await import("../app.v1");
const { createProjectApp } = await import("~/server/api/security");
const { ProjectionValidationError } = await import(
  "~/server/traces/projection"
);
const securedTest = createProjectApp({ basePath: "/" });
registerTracesRoutes(securedTest);
const v1App = securedTest.hono;

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
      traceChecks: {
        "trace-1": [
          {
            evaluation_id: "eval-1",
            evaluator_id: "evaluator-1",
            name: "sentiment",
            status: "processed",
            score: 0.95,
            label: "positive",
            timestamps: { started_at: 1000, finished_at: 2000 },
          },
        ],
        "trace-2": [],
      },
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
        "Input: hello\nOutput: world",
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

  describe("when traceChecks contains evaluations", () => {
    it("includes evaluations in json format response traces", async () => {
      const res = await searchRequest({
        startDate: 1000,
        endDate: 5000,
        format: "json",
      });
      const body = await res.json();
      expect(body.traces[0].evaluations).toEqual([
        expect.objectContaining({ evaluation_id: "eval-1", score: 0.95 }),
      ]);
      expect(body.traces[1].evaluations).toEqual([]);
    });

    it("includes evaluations in digest format response traces", async () => {
      const res = await searchRequest({
        startDate: 1000,
        endDate: 5000,
        format: "digest",
      });
      const body = await res.json();
      expect(body.traces[0].evaluations).toEqual([
        expect.objectContaining({ evaluation_id: "eval-1", score: 0.95 }),
      ]);
      expect(body.traces[1].evaluations).toEqual([]);
    });

    it("includes evaluations when llmMode is true", async () => {
      const res = await searchRequest({
        startDate: 1000,
        endDate: 5000,
        llmMode: true,
      });
      const body = await res.json();
      expect(body.traces[0].evaluations).toEqual([
        expect.objectContaining({ evaluation_id: "eval-1", score: 0.95 }),
      ]);
      expect(body.traces[1].evaluations).toEqual([]);
    });
  });

  describe("when result set is large", () => {
    it("serializes many traces with correct comma separation", async () => {
      const manyTraces = Array.from({ length: 50 }, (_, i) => ({
        trace_id: `trace-${i}`,
        project_id: "project-123",
        input: { value: `input-${i}` },
        output: { value: `output-${i}` },
        timestamps: {
          started_at: i * 100,
          inserted_at: i * 100,
          updated_at: i * 100,
        },
        metadata: {},
        spans: [],
      }));

      mockGetAllTracesForProject.mockResolvedValue({
        groups: [manyTraces],
        totalHits: 50,
        traceChecks: Object.fromEntries(
          manyTraces.map((t) => [t.trace_id, []]),
        ),
        scrollId: "next-page-token",
      });

      const res = await searchRequest({
        startDate: 0,
        endDate: 10000,
      });

      const body = await res.json();
      expect(body.traces).toHaveLength(50);
      expect(body.traces[0].trace_id).toBe("trace-0");
      expect(body.traces[49].trace_id).toBe("trace-49");
      expect(body.pagination.scrollId).toBe("next-page-token");
    });

    it("returns valid JSON for empty result set", async () => {
      mockGetAllTracesForProject.mockResolvedValue({
        groups: [[]],
        totalHits: 0,
        traceChecks: {},
        scrollId: undefined,
      });

      const res = await searchRequest({
        startDate: 1000,
        endDate: 5000,
      });

      const body = await res.json();
      expect(body.traces).toHaveLength(0);
      expect(body.pagination.totalHits).toBe(0);
    });
  });

  describe("when a trace fails to serialize", () => {
    it("drops it and surfaces a skipped count in pagination", async () => {
      const circular: Record<string, unknown> = {
        trace_id: "bad-trace",
        project_id: "project-123",
        timestamps: { started_at: 1, inserted_at: 1, updated_at: 1 },
        metadata: {},
        spans: [],
      };
      // A circular reference makes JSON.stringify throw in the serialize loop.
      (circular.metadata as Record<string, unknown>).self = circular;

      mockGetAllTracesForProject.mockResolvedValue({
        groups: [[circular, sampleTraces[0]]],
        totalHits: 2,
        traceChecks: { "bad-trace": [], "trace-1": [] },
        scrollId: undefined,
      });

      const res = await searchRequest({
        startDate: 1000,
        endDate: 5000,
        format: "json",
      });

      const body = await res.json();
      expect(body.traces).toHaveLength(1);
      expect(body.traces[0].trace_id).toBe("trace-1");
      expect(body.pagination.skipped).toBe(1);
    });

    it("omits skipped from pagination when nothing is dropped", async () => {
      const res = await searchRequest({
        startDate: 1000,
        endDate: 5000,
        format: "json",
      });

      const body = await res.json();
      expect(body.pagination).not.toHaveProperty("skipped");
    });
  });

  // The projector and plan shape come from the compiler (mocked here). These
  // tests cover the SURFACE contract: when to compile, what to forward, how the
  // response envelope changes.
  const fakeProjection = () => ({
    schema: {
      from: "traces" as const,
      columns: [
        { path: "trace_id", type: "string" as const, collection: false },
      ],
    },
    plan: {
      from: "traces" as const,
      needsIO: false,
      needsEvents: false,
      eventPaths: [],
      needsAnnotations: false,
      annotationPaths: [],
      needsEvaluations: false,
      evaluationPaths: [],
    },
    project: (trace: { trace_id: string }) => ({ trace_id: trace.trace_id }),
  });

  describe("when no projection select is provided", () => {
    it("does not compile a projection", async () => {
      await searchRequest({ startDate: 1000, endDate: 5000, format: "json" });
      expect(mockCompileProjection).not.toHaveBeenCalled();
    });

    /** @scenario "Request without from or select returns the current response shape" */
    it("omits the schema field from the response", async () => {
      const res = await searchRequest({
        startDate: 1000,
        endDate: 5000,
        format: "json",
      });
      const body = await res.json();
      expect(body).not.toHaveProperty("schema");
    });
  });

  describe("when a projection select is provided", () => {
    beforeEach(() => {
      mockCompileProjection.mockReturnValue(fakeProjection());
    });

    it("compiles the projection with from, select, and protections", async () => {
      await searchRequest({
        startDate: 1000,
        endDate: 5000,
        from: "traces",
        select: ["trace_id"],
      });
      expect(mockCompileProjection).toHaveBeenCalledWith({
        from: "traces",
        select: ["trace_id"],
        protections: {},
      });
    });

    it("forwards the compiled plan to the trace service", async () => {
      await searchRequest({
        startDate: 1000,
        endDate: 5000,
        from: "traces",
        select: ["trace_id"],
      });
      const options = mockGetAllTracesForProject.mock.calls[0]![2];
      expect(options.projection).toEqual(fakeProjection().plan);
    });

    it("projects each trace through the compiled projector", async () => {
      const res = await searchRequest({
        startDate: 1000,
        endDate: 5000,
        from: "traces",
        select: ["trace_id"],
      });
      const body = await res.json();
      expect(body.traces).toEqual([
        { trace_id: "trace-1" },
        { trace_id: "trace-2" },
      ]);
    });

    /** @scenario "Response includes schema when select is present" */
    it("includes the resolved schema in the response envelope", async () => {
      const res = await searchRequest({
        startDate: 1000,
        endDate: 5000,
        from: "traces",
        select: ["trace_id"],
      });
      const body = await res.json();
      expect(body.schema).toEqual(fakeProjection().schema);
    });

    /** @scenario "Select without from defaults to the traces entity root" */
    it("defaults from to traces when only select is provided", async () => {
      const res = await searchRequest({
        startDate: 1000,
        endDate: 5000,
        select: ["trace_id"],
      });
      expect(mockCompileProjection).toHaveBeenCalledWith({
        from: "traces",
        select: ["trace_id"],
        protections: {},
      });
      const body = await res.json();
      expect(body).toHaveProperty("schema");
    });
  });

  describe("when the projection select is invalid", () => {
    beforeEach(() => {
      mockCompileProjection.mockImplementation(() => {
        throw new ProjectionValidationError(["nonexistent_field"]);
      });
    });

    /** @scenario "Unknown select path returns 400" */
    it("responds 400", async () => {
      const res = await searchRequest({
        startDate: 1000,
        endDate: 5000,
        select: ["nonexistent_field"],
      });
      expect(res.status).toBe(400);
    });

    it("names the invalid path in the error message", async () => {
      const res = await searchRequest({
        startDate: 1000,
        endDate: 5000,
        select: ["nonexistent_field"],
      });
      const body = await res.json();
      expect(body.message).toContain("nonexistent_field");
    });

    it("does not query the trace service", async () => {
      await searchRequest({
        startDate: 1000,
        endDate: 5000,
        select: ["nonexistent_field"],
      });
      expect(mockGetAllTracesForProject).not.toHaveBeenCalled();
    });
  });

  describe("when the projection request fails schema validation", () => {
    /** @scenario "Unknown from entity returns 400" */
    it("rejects an unsupported from entity with 400", async () => {
      const res = await searchRequest({
        startDate: 1000,
        endDate: 5000,
        from: "sessions",
        select: ["trace_id"],
      });
      expect(res.status).toBe(400);
      expect(mockCompileProjection).not.toHaveBeenCalled();
    });

    /** @scenario "Empty select array returns 400" */
    it("rejects an empty select array with 400", async () => {
      const res = await searchRequest({
        startDate: 1000,
        endDate: 5000,
        select: [],
      });
      expect(res.status).toBe(400);
      expect(mockCompileProjection).not.toHaveBeenCalled();
    });

    it("rejects a select with more than 200 paths with 400", async () => {
      const res = await searchRequest({
        startDate: 1000,
        endDate: 5000,
        select: Array.from({ length: 201 }, (_, i) => `metadata.key_${i}`),
      });
      expect(res.status).toBe(400);
      expect(mockCompileProjection).not.toHaveBeenCalled();
    });

    it("rejects a select path longer than 256 characters with 400", async () => {
      const res = await searchRequest({
        startDate: 1000,
        endDate: 5000,
        select: [`metadata.${"x".repeat(300)}`],
      });
      expect(res.status).toBe(400);
      expect(mockCompileProjection).not.toHaveBeenCalled();
    });
  });

  describe("when a date axis is specified", () => {
    it("forwards dateField 'updated' to the trace service", async () => {
      await searchRequest({
        startDate: 1000,
        endDate: 5000,
        dateField: "updated",
      });
      const options = mockGetAllTracesForProject.mock.calls[0]![2];
      expect(options.dateField).toBe("updated");
    });

    it("defaults dateField to occurred when not specified", async () => {
      await searchRequest({ startDate: 1000, endDate: 5000 });
      const options = mockGetAllTracesForProject.mock.calls[0]![2];
      expect(options.dateField).toBe("occurred");
    });

    /** @scenario "Invalid dateField value returns 400" */
    it("rejects an unsupported date axis with 400", async () => {
      const res = await searchRequest({
        startDate: 1000,
        endDate: 5000,
        dateField: "created",
      });
      expect(res.status).toBe(400);
    });
  });
});
