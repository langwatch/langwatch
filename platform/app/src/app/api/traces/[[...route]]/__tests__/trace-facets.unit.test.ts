/**
 * `GET /api/traces/facets` at the route level.
 *
 * The facet store is mocked; what is real here is the routing, the query
 * schema, the field resolution and the two response shapes. Three of those are
 * where this endpoint can be wrong in a way no downstream test would catch:
 * the route order (hono would otherwise read `facets` as a trace id), the
 * canonical-versus-legacy attribute prefix, and the refusal for a field with no
 * values to list.
 *
 * @see specs/traces/trace-filter-api.feature
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetDiscover = vi.fn();
const mockGetFacetValues = vi.fn();
const mockGetAllTracesForProject = vi.fn();
const mockGetById = vi.fn();

vi.mock("~/server/app-layer/app", () => {
  const app = () => ({
    traces: {
      list: {
        getDiscover: mockGetDiscover,
        getFacetValues: mockGetFacetValues,
      },
    },
  });
  return { getApp: app, tryGetApp: app };
});

vi.mock("~/server/traces/trace.service", () => ({
  AmbiguousTraceIdPrefixError: class extends Error {},
  TraceService: {
    create: () => ({
      getAllTracesForProject: mockGetAllTracesForProject,
      getById: mockGetById,
      getEvaluationsMultiple: vi.fn().mockResolvedValue({}),
    }),
  },
}));

const mockGetProtections = vi.fn();

vi.mock("~/server/api/utils", () => ({
  getProtectionsForProject: mockGetProtections,
}));

/** A project that shows captured content and restricts no attribute. */
const OPEN_PROTECTIONS = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("~/server/traces/trace-blob-resolution.deps", () => ({
  buildTraceBlobResolutionDeps: () => ({}),
}));

vi.mock("~/server/tracer/spanToReadableSpan", () => ({
  formatSpansDigest: vi.fn().mockResolvedValue(""),
}));

vi.mock("~/server/traces/trace-formatting", () => ({
  generateAsciiTree: vi.fn().mockReturnValue(""),
  formatTraceSummaryDigest: vi.fn().mockReturnValue(""),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("~/app/api/middleware/auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/app/api/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: { set: (k: string, v: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("project", { id: "project-123", apiKey: "key-123", slug: "p" });
      await next();
    },
    requirePermission: () => async (_c: unknown, next: () => Promise<void>) =>
      next(),
  };
});

const { registerTracesRoutes } = await import("../app.v1");
const { createProjectApp } = await import("~/server/api/security");

const secured = createProjectApp({ basePath: "/" });
registerTracesRoutes(secured);

const testApp = new Hono();
testApp.use("*", async (c, next) => {
  c.set("project" as never, {
    id: "project-123",
    apiKey: "key-123",
    slug: "p",
  });
  await next();
});
testApp.route("/", secured.hono);
const facets = (query = "") =>
  testApp.request(`http://localhost/facets${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetProtections.mockResolvedValue(OPEN_PROTECTIONS);
  mockGetDiscover.mockResolvedValue({
    facets: [
      {
        key: "model",
        kind: "categorical",
        label: "Model",
        group: "span",
        topValues: [{ value: "gpt-5-mini", count: 7 }],
        totalDistinct: 1,
      },
    ],
    pending: false,
  });
  mockGetFacetValues.mockResolvedValue({
    values: [
      { value: "gpt-5-mini", count: 7 },
      { value: "gpt-5", count: 3 },
    ],
    totalDistinct: 5,
  });
});

describe("GET /facets", () => {
  describe("when no field is given", () => {
    /** @scenario "Without a field, the facets endpoint answers the whole discovery payload" */
    it("answers the discovery payload with its pending flag", async () => {
      const response = await facets();
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        facets: { key: string; topValues: unknown[] }[];
        pending: boolean;
      };
      expect(body.facets[0]?.key).toBe("model");
      expect(body.facets[0]?.topValues).toHaveLength(1);
      expect(body.pending).toBe(false);
      expect(mockGetFacetValues).not.toHaveBeenCalled();
    });

    it("defaults the window to the last day", async () => {
      await facets();
      const { timeRange } = mockGetDiscover.mock.calls[0]?.[0] as {
        timeRange: { from: number; to: number };
      };
      expect(timeRange.to - timeRange.from).toBe(24 * 60 * 60 * 1000);
    });

    /**
     * Hono matches in registration order and `/:traceId` would swallow
     * `facets`, answering not found for a route that exists.
     *
     */
    /** @scenario "The facets route is not read as a trace id" */
    it("is not answered by the trace-by-id route", async () => {
      const response = await facets();
      expect(response.status).toBe(200);
      expect(mockGetById).not.toHaveBeenCalled();
    });
  });

  describe("when a field is given", () => {
    /** @scenario "With a field, the facets endpoint answers that field's values and counts" */
    it("answers the values, the distinct total and whether more remain", async () => {
      const response = await facets("?field=model");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        values: [
          { value: "gpt-5-mini", count: 7 },
          { value: "gpt-5", count: 3 },
        ],
        total: 5,
        hasMore: true,
      });
    });

    it("reports no more remaining once the page reaches the total", async () => {
      mockGetFacetValues.mockResolvedValue({
        values: [{ value: "gpt-5", count: 3 }],
        totalDistinct: 1,
      });
      const response = await facets("?field=model");
      expect(((await response.json()) as { hasMore: boolean }).hasMore).toBe(
        false,
      );
    });

    /** @scenario "A prefix narrows a field's values" */
    it("passes the prefix and the paging to the facet store", async () => {
      await facets("?field=model&prefix=gpt&limit=5&offset=10");
      expect(mockGetFacetValues).toHaveBeenCalledWith(
        expect.objectContaining({
          facetKey: "model",
          prefix: "gpt",
          limit: 5,
          offset: 10,
        }),
      );
    });

    /**
     * The reference publishes `trace.attribute.<key>`; the facet store's own
     * prefix for the same thing is the older `attribute.<key>`. A caller must
     * be able to paste the name it read.
     *
     */
    /** @scenario "An attribute key is a field like any other" */
    it("accepts the canonical trace-attribute prefix", async () => {
      await facets("?field=trace.attribute.langwatch.user_id");
      expect(mockGetFacetValues).toHaveBeenCalledWith(
        expect.objectContaining({ facetKey: "attribute.langwatch.user_id" }),
      );
    });

    it("accepts the span and event attribute prefixes unchanged", async () => {
      await facets("?field=span.attribute.gen_ai.request.model");
      expect(mockGetFacetValues).toHaveBeenCalledWith(
        expect.objectContaining({
          facetKey: "span.attribute.gen_ai.request.model",
        }),
      );
    });

    /** @scenario "An unknown field is refused rather than answered empty" */
    it("refuses a field with no values to list", async () => {
      const response = await facets("?field=not_a_facet");
      expect(response.status).toBe(422);
      // The traces family publishes the older flat envelope, which carries the
      // code under `error` rather than under `code`.
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("validation_error");
      expect(mockGetFacetValues).not.toHaveBeenCalled();
    });

    it("refuses a range facet, which has bounds rather than values", async () => {
      const response = await facets("?field=duration");
      expect(response.status).toBe(422);
      expect(mockGetFacetValues).not.toHaveBeenCalled();
    });

    it("refuses an attribute prefix with no key after it", async () => {
      const response = await facets("?field=span.attribute.");
      expect(response.status).toBe(422);
      expect(mockGetFacetValues).not.toHaveBeenCalled();
    });
  });

  describe("when the window is given as epoch milliseconds", () => {
    /** @scenario "A window bound is accepted as epoch milliseconds or as an ISO string" */
    it("accepts the digits a query string carries them as", async () => {
      const response = await facets(
        "?field=model&startDate=1720000000000&endDate=1720086400000",
      );
      expect(response.status).toBe(200);
      expect(mockGetFacetValues).toHaveBeenCalledWith(
        expect.objectContaining({
          timeRange: { from: 1720000000000, to: 1720086400000 },
        }),
      );
    });

    /**
     * `Date.parse` rolls an impossible date forward rather than refusing it, so
     * a window ending on the 30th of February quietly covers two days the
     * caller never asked for.
     */
    /** @scenario "A window bound naming a day that does not exist is refused" */
    it("refuses a day the calendar does not have", async () => {
      const response = await facets("?field=model&endDate=2026-02-30");
      expect(response.status).toBe(422);
      expect(mockGetFacetValues).not.toHaveBeenCalled();
    });

    /** @scenario "A window bound naming a day that does not exist is refused" */
    it("accepts the last day a month really has", async () => {
      const response = await facets("?field=model&endDate=2026-02-28");
      expect(response.status).toBe(200);
    });

    /** @scenario "A window bound naming a day that does not exist is refused" */
    it("accepts a leap day in a leap year", async () => {
      const response = await facets("?field=model&endDate=2028-02-29");
      expect(response.status).toBe(200);
    });

    it("accepts an ISO string on the same parameters", async () => {
      const response = await facets(
        "?field=model&startDate=2026-09-01T00:00:00.000Z",
      );
      expect(response.status).toBe(200);
      const { timeRange } = mockGetFacetValues.mock.calls[0]?.[0] as {
        timeRange: { from: number };
      };
      expect(timeRange.from).toBe(Date.parse("2026-09-01T00:00:00.000Z"));
    });
  });

  describe("when the project withholds captured content", () => {
    beforeEach(() => {
      mockGetProtections.mockResolvedValue({
        ...OPEN_PROTECTIONS,
        canSeeCapturedInput: false,
      });
    });

    /** @scenario "Attribute values are withheld where captured content is" */
    it("refuses the values behind an attribute key", async () => {
      const response = await facets(
        "?field=span.attribute.gen_ai.request.model",
      );
      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("trace_attribute_values_withheld");
      expect(mockGetFacetValues).not.toHaveBeenCalled();
    });

    /** @scenario "Attribute values are withheld where captured content is" */
    it("still answers a named facet, which is a dimension rather than content", async () => {
      const response = await facets("?field=model");
      expect(response.status).toBe(200);
      expect(mockGetFacetValues).toHaveBeenCalled();
    });

    /** @scenario "Attribute values are withheld where captured content is" */
    it("still answers the discovery payload, which lists keys rather than values", async () => {
      const response = await facets();
      expect(response.status).toBe(200);
    });
  });

  describe("when a retention cutoff hides older content from this caller", () => {
    const CUTOFF = Date.now() - 2 * 24 * 60 * 60 * 1000;

    beforeEach(() => {
      mockGetProtections.mockResolvedValue({
        ...OPEN_PROTECTIONS,
        visibilityCutoffMs: CUTOFF,
      });
    });

    /**
     * An attribute value is the content the cutoff hides. Listing distinct
     * values over an unbounded window would hand back, one value at a time,
     * what a trace read of the same rows redacts.
     */
    /** @scenario "A retention cutoff bounds the window an attribute facet reads" */
    it("raises the window floor to the cutoff for an attribute key", async () => {
      await facets("?field=span.attribute.gen_ai.request.model&startDate=1000");
      const { timeRange } = mockGetFacetValues.mock.calls[0]?.[0] as {
        timeRange: { from: number };
      };
      expect(timeRange.from).toBe(CUTOFF);
    });

    /** @scenario "A retention cutoff bounds the window an attribute facet reads" */
    it("leaves a named facet's window alone, which the read path does not redact", async () => {
      await facets("?field=model&startDate=1000");
      const { timeRange } = mockGetFacetValues.mock.calls[0]?.[0] as {
        timeRange: { from: number };
      };
      expect(timeRange.from).toBe(1000);
    });

    /** @scenario "A retention cutoff bounds the window an attribute facet reads" */
    it("leaves a window already inside the cutoff alone", async () => {
      const inside = CUTOFF + 60_000;
      await facets(
        `?field=span.attribute.gen_ai.request.model&startDate=${inside}`,
      );
      const { timeRange } = mockGetFacetValues.mock.calls[0]?.[0] as {
        timeRange: { from: number };
      };
      expect(timeRange.from).toBe(inside);
    });
  });

  describe("when one attribute is restricted to an audience this caller is not in", () => {
    beforeEach(() => {
      mockGetProtections.mockResolvedValue({
        ...OPEN_PROTECTIONS,
        hiddenAttributes: [
          { pattern: "gen_ai.prompt", visibleTo: "Security group" },
        ],
      });
    });

    /** @scenario "Attribute values are withheld where captured content is" */
    it("refuses that key's values", async () => {
      const response = await facets("?field=span.attribute.gen_ai.prompt");
      expect(response.status).toBe(403);
      expect(mockGetFacetValues).not.toHaveBeenCalled();
    });

    /** @scenario "Attribute values are withheld where captured content is" */
    it("answers a key the rule does not name", async () => {
      const response = await facets(
        "?field=span.attribute.gen_ai.request.model",
      );
      expect(response.status).toBe(200);
    });
  });
});
