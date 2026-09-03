/**
 * `POST /api/traces/search`, through the real Hono route family, focused on
 * the projection DSL (`from`/`select`) surface — when to compile a
 * projection, what the compiled plan changes about the response envelope,
 * and how an invalid `from`/`select` request is refused.
 *
 * Was
 * `platform/app/src/app/api/traces/[[...route]]/__tests__/search-traces.unit.test.ts`,
 * against the route's own `app.v1.ts`. The route now lives in this package as
 * `createTracesRestApp`; the projection compiler is mocked here the same way
 * it was there, so these stay surface tests independent of the compiler
 * implementation (covered separately by
 * `trace-projection-compile.service.unit.test.ts`).
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import type { Trace } from "@langwatch/trace-contract";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { CompiledProjection } from "#services/trace-projection.types";
import { ProjectionValidationError } from "#services/trace-projection.types";
import {
  createTracesRestApp,
  traceSearchBodyExtensions,
  type TraceSearchBody,
  type TracesRestPorts,
} from "../traces.api";

vi.mock("#services/trace-formatting.service", () => ({
  generateAsciiTree: vi.fn().mockReturnValue("ascii tree"),
  formatTraceSummaryDigest: vi.fn().mockReturnValue("Input: hello\nOutput: world"),
}));

vi.mock("#services/trace-readable-span.service", () => ({
  formatSpansDigest: vi.fn().mockResolvedValue("full span digest"),
}));

// Keep the real request schema + `ProjectionValidationError` (so validation
// and the 422 path are exercised for real) and stub only `compileProjection`.
const mockCompileProjection = vi.fn();
vi.mock("#services/trace-projection-compile.service", () => ({
  compileProjection: (args: unknown) => mockCompileProjection(args),
}));

const mockGetAllTracesForProject = vi.fn();

const project = {
  id: "project-123",
  name: "Project 123",
  slug: "project-123",
  teamId: "team-1",
  organizationId: "organization-1",
  isPersonal: false,
  ownerUserId: null,
};

/**
 * A handled refusal keeps its own status, code and reasons. Anything else is
 * a bug this family should never actually hit.
 */
const boundaryErrorHandler: ErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    const serialized = error.serialize();
    return c.json(
      { error: serialized.code, reasons: serialized.reasons },
      serialized.httpStatus as 422,
    );
  }
  return c.json({ error: "internal_server_error" }, 500);
};

function testSecurity(): AppRestSecurity {
  const pass: MiddlewareHandler = async (_c, next) => next();
  const authenticateProject: MiddlewareHandler = async (c, next) => {
    c.set("project", project);
    await next();
  };

  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: boundaryErrorHandler,
    canonicalErrorHandler: boundaryErrorHandler,
    authenticateProject: () => authenticateProject,
    authorizeProjectPermission: () => pass,
    authorizeApiKeyCeiling: () => pass,
    authenticateOrganization: () => pass,
    authorizeOrganizationPermission: () => pass,
    authorizeRouteProjectPermission: () => pass,
    authenticateOrganizationThrowing: pass,
    authorizeOrganizationPermissionThrowing: () => pass,
  };

  return createAppRestSecurity(ports);
}

/** The additive DSL fields merged onto a minimal analytics filter body. */
const searchBodySchema = z
  .object({
    startDate: z.union([z.string(), z.number()]),
    endDate: z.union([z.string(), z.number()]),
    pageSize: z.number().optional(),
    ...traceSearchBodyExtensions,
  })
  .catchall(z.unknown()) as unknown as TracesRestPorts<
  TraceSearchBody,
  unknown
>["searchBodySchema"];

function buildApi() {
  const ports: TracesRestPorts<TraceSearchBody, unknown> = {
    searchBodySchema,
    traces: () => ({
      getAllTracesForProject: mockGetAllTracesForProject,
      getById: vi.fn(),
      getEvaluationsMultiple: vi.fn(),
    }),
    getProtections: vi.fn().mockResolvedValue({}),
    platformUrl: ({ projectSlug, path }) => `https://app.test/${projectSlug}${path}`,
  };

  const app = createTracesRestApp({ security: testSecurity(), ports });

  return {
    fetch: (path: string, init?: RequestInit) =>
      app.hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}

function searchRequest(api: ReturnType<typeof buildApi>, body: Record<string, unknown>) {
  return api.fetch("/api/traces/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The two response shapes this route produces: the search envelope, and a handled 422 refusal. */
type SearchResponseBody = {
  traces?: Array<Record<string, unknown>>;
  schema?: unknown;
  error?: string;
  reasons?: Array<{ code: string; meta: Record<string, unknown> }>;
};

describe("given POST /api/traces/search", () => {
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
      traceChecks: { "trace-1": [], "trace-2": [] },
      scrollId: undefined,
    });
  });

  const fakeProjection = (): CompiledProjection => ({
    schema: {
      from: "traces" as const,
      columns: [{ path: "trace_id", type: "string" as const, collection: false }],
    },
    plan: {
      from: "traces" as const,
      needsInput: false,
      needsOutput: false,
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
      const api = buildApi();
      await searchRequest(api, { startDate: 1000, endDate: 5000, format: "json" });
      expect(mockCompileProjection).not.toHaveBeenCalled();
    });

    /** @scenario "Request without from or select returns the current response shape" */
    it("omits the schema field from the response", async () => {
      const api = buildApi();
      const res = await searchRequest(api, { startDate: 1000, endDate: 5000, format: "json" });
      const body = (await res.json()) as SearchResponseBody;
      expect(body).not.toHaveProperty("schema");
    });
  });

  describe("when a projection select is provided", () => {
    it("compiles the projection with from, select, and protections", async () => {
      const api = buildApi();
      mockCompileProjection.mockReturnValue(fakeProjection());
      await searchRequest(api, {
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

    it("projects each trace through the compiled projector", async () => {
      const api = buildApi();
      mockCompileProjection.mockReturnValue(fakeProjection());
      const res = await searchRequest(api, {
        startDate: 1000,
        endDate: 5000,
        from: "traces",
        select: ["trace_id"],
      });
      const body = (await res.json()) as SearchResponseBody;
      expect(body.traces).toEqual([{ trace_id: "trace-1" }, { trace_id: "trace-2" }]);
    });

    /** @scenario "Response includes schema when select is present" */
    it("includes the resolved schema in the response envelope", async () => {
      const api = buildApi();
      mockCompileProjection.mockReturnValue(fakeProjection());
      const res = await searchRequest(api, {
        startDate: 1000,
        endDate: 5000,
        from: "traces",
        select: ["trace_id"],
      });
      const body = (await res.json()) as SearchResponseBody;
      expect(body.schema).toEqual(fakeProjection().schema);
    });

    /** @scenario "Select without from defaults to the traces entity root" */
    it("defaults from to traces when only select is provided", async () => {
      const api = buildApi();
      mockCompileProjection.mockReturnValue(fakeProjection());
      const res = await searchRequest(api, {
        startDate: 1000,
        endDate: 5000,
        select: ["trace_id"],
      });
      expect(mockCompileProjection).toHaveBeenCalledWith({
        from: "traces",
        select: ["trace_id"],
        protections: {},
      });
      const body = (await res.json()) as SearchResponseBody;
      expect(body).toHaveProperty("schema");
    });
  });

  describe("when the projection select is invalid", () => {
    beforeEach(() => {
      mockCompileProjection.mockImplementation(() => {
        throw new ProjectionValidationError(["nonexistent_field"]);
      });
    });

    /** @scenario "Unknown select path returns 422" */
    it("responds 422", async () => {
      const api = buildApi();
      const res = await searchRequest(api, {
        startDate: 1000,
        endDate: 5000,
        select: ["nonexistent_field"],
      });
      expect(res.status).toBe(422);
    });

    it("names the invalid path in a reason rather than in the message", async () => {
      const api = buildApi();
      const res = await searchRequest(api, {
        startDate: 1000,
        endDate: 5000,
        select: ["nonexistent_field"],
      });
      const body = (await res.json()) as SearchResponseBody;
      expect(body.error).toBe("validation_error");
      expect(body.reasons).toHaveLength(1);
      expect(body.reasons![0]!.code).toBe("schema_failure");
      expect(body.reasons![0]!.meta.field).toBe("select");
      expect(body.reasons![0]!.meta.received).toBe("nonexistent_field");
    });

    it("does not query the trace service", async () => {
      const api = buildApi();
      await searchRequest(api, {
        startDate: 1000,
        endDate: 5000,
        select: ["nonexistent_field"],
      });
      expect(mockGetAllTracesForProject).not.toHaveBeenCalled();
    });
  });

  describe("when the projection request fails schema validation", () => {
    /** @scenario "Unknown from entity returns 422" */
    it("rejects an unsupported from entity with 422", async () => {
      const api = buildApi();
      const res = await searchRequest(api, {
        startDate: 1000,
        endDate: 5000,
        from: "sessions",
        select: ["trace_id"],
      });
      expect(res.status).toBe(422);
      expect(mockCompileProjection).not.toHaveBeenCalled();
    });

    /** @scenario "Empty select array returns 422" */
    it("rejects an empty select array with 422", async () => {
      const api = buildApi();
      const res = await searchRequest(api, { startDate: 1000, endDate: 5000, select: [] });
      expect(res.status).toBe(422);
      expect(mockCompileProjection).not.toHaveBeenCalled();
    });

    it("rejects a select with more than 200 paths with 422", async () => {
      const api = buildApi();
      const res = await searchRequest(api, {
        startDate: 1000,
        endDate: 5000,
        select: Array.from({ length: 201 }, (_, i) => `metadata.key_${i}`),
      });
      expect(res.status).toBe(422);
      expect(mockCompileProjection).not.toHaveBeenCalled();
    });

    it("rejects a select path longer than 256 characters with 422", async () => {
      const api = buildApi();
      const res = await searchRequest(api, {
        startDate: 1000,
        endDate: 5000,
        select: [`metadata.${"x".repeat(300)}`],
      });
      expect(res.status).toBe(422);
      expect(mockCompileProjection).not.toHaveBeenCalled();
    });
  });

  describe("when a date axis is specified", () => {
    it("forwards dateField 'updated' to the trace service", async () => {
      const api = buildApi();
      await searchRequest(api, { startDate: 1000, endDate: 5000, dateField: "updated" });
      const options = mockGetAllTracesForProject.mock.calls[0]![2];
      expect(options.dateField).toBe("updated");
    });

    it("defaults dateField to occurred when not specified", async () => {
      const api = buildApi();
      await searchRequest(api, { startDate: 1000, endDate: 5000 });
      const options = mockGetAllTracesForProject.mock.calls[0]![2];
      expect(options.dateField).toBe("occurred");
    });

    /** @scenario "Invalid dateField value returns 422" */
    it("rejects an unsupported date axis with 422", async () => {
      const api = buildApi();
      const res = await searchRequest(api, {
        startDate: 1000,
        endDate: 5000,
        dateField: "created",
      });
      expect(res.status).toBe(422);
    });
  });
});
