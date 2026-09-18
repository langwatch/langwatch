/**
 * Who may read the query reference, and what each of them gets.
 *
 * The document joins two languages that belong to two families. Gating the
 * whole of it on `analytics:view`, the way the rest of this family is gated,
 * would refuse a key scoped to `traces:view` the only document describing the
 * trace filter, a language that key is entitled to use. So the door answers
 * any authenticated key and the LangWatchQL half is withheld instead.
 * `GET /api/v1/query/schema` refuses such a key outright; this document
 * answers, minus the catalog that door would have refused.
 *
 * The ceiling and the scope resolution are mocked rather than reimplemented:
 * what is under test is that the route asks both and shapes the document from
 * their answers, not what either of them decides.
 *
 * @see specs/analytics/query-reference.feature
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KeyAuthVariables } from "~/server/api-key/auth-middleware";

const mockEnforceCeiling = vi.fn();
const mockResolveScope = vi.fn();

/** Stands in for the key auth: an authenticated key is already resolved. */
const stubKeyAuth =
  () =>
  async (
    c: { set: (key: string, value: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set("keyPrincipal", {
      kind: "apiKey",
      apiKeyId: "key-123",
      userId: null,
      organizationId: "org-123",
    });
    c.set("resolvedToken", { type: "apiKey" });
    await next();
  };

vi.mock("~/server/api-key/auth-middleware", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/server/api-key/auth-middleware")>();
  return {
    ...actual,
    enforceApiKeyCeiling: mockEnforceCeiling,
    createUnifiedKeyAuthMiddleware: stubKeyAuth,
  };
});

vi.mock("../[[...route]]/queryScope", () => ({
  resolveLwqlQueryScope: (...args: unknown[]) => mockResolveScope(...args),
}));

vi.mock("~/app/api/middleware/app-context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/app/api/middleware/app-context")>();
  return { ...actual, appFromContext: () => ({}) };
});

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { ApiKeyPermissionDeniedError } = await import("~/server/api-key/errors");
const { registerQueryRoutes } = await import("../[[...route]]/app.v1");
const { createProjectApp } = await import("~/server/api/security");

const secured = createProjectApp<KeyAuthVariables>({
  basePath: "/",
  errorEnvelope: "canonical",
});
registerQueryRoutes(secured);

const testApp = new Hono();
testApp.route("/", secured.hono);

const readReference = () => testApp.request("http://localhost/reference");

/** What the ceiling really throws when the key does not hold the permission. */
const ceilingRefusal = () => new ApiKeyPermissionDeniedError("analytics:view");

/** Everything ungated, so what the document withholds is the door's doing. */
const openProtections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

/** One readable project: the scope a project-bound key resolves to. */
const oneReadableProject = () => ({
  projects: [{ id: "project-123", lwqlKey: "lwql-key" }],
  protections: openProtections,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveScope.mockResolvedValue(oneReadableProject());
});

describe("GET /reference", () => {
  describe("when the key holds analytics:view on a readable project", () => {
    beforeEach(() => {
      mockEnforceCeiling.mockResolvedValue(undefined);
    });

    /** @scenario "A key entitled only to traces still reads the filter vocabulary" */
    it("tells caches not to store a document shaped by one credential", async () => {
      const response = await readReference();
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    });

    it("answers both halves", async () => {
      const response = await readReference();
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        lwql: { enabled: boolean; schema: { views: unknown[] } };
        traceFilter: { fields: unknown[] };
      };
      expect(body.lwql.enabled).toBe(true);
      expect(body.lwql.schema.views.length).toBeGreaterThan(0);
      expect(body.traceFilter.fields.length).toBeGreaterThan(0);
    });
  });

  describe("when the key is scoped to traces but not analytics", () => {
    beforeEach(() => {
      mockEnforceCeiling.mockRejectedValue(ceilingRefusal());
    });

    /** @scenario "A key entitled only to traces still reads the filter vocabulary" */
    it("answers the filter half in full and closes the LangWatchQL half", async () => {
      const response = await readReference();
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        lwql: { enabled: boolean; schema: { views: unknown[] } };
        traceFilter: { fields: unknown[]; syntax: string };
        examples: { language: string; available: boolean }[];
      };
      expect(body.traceFilter.fields.length).toBeGreaterThan(0);
      expect(body.traceFilter.syntax).toContain("trace.attribute.");
      expect(body.lwql.enabled).toBe(false);
      expect(body.lwql.schema.views).toEqual([]);
      expect(
        body.examples
          .filter((example) => example.language === "lwql")
          .every((example) => !example.available),
      ).toBe(true);
    });

    /** @scenario "A key entitled only to traces still reads the filter vocabulary" */
    it("keeps the filter examples runnable", async () => {
      const response = await readReference();
      const body = (await response.json()) as {
        examples: { language: string; available: boolean }[];
      };
      const filters = body.examples.filter(
        (example) => example.language === "trace-filter",
      );
      expect(filters.length).toBeGreaterThan(0);
      expect(filters.every((example) => example.available)).toBe(true);
    });
  });

  describe("when the key clears the ceiling but reads no project", () => {
    beforeEach(() => {
      mockEnforceCeiling.mockResolvedValue(undefined);
      mockResolveScope.mockResolvedValue({
        projects: [],
        protections: openProtections,
      });
    });

    // An empty scope is a valid credential, not a refusal (#8085): the run door
    // reads zero rows for it. Publishing the catalog to a key that can query
    // nothing would describe a surface it cannot reach, so the half closes for
    // the same reason it closes for a `traces:view` key.
    /** @scenario "A key entitled only to traces still reads the filter vocabulary" */
    it("closes the LangWatchQL half and keeps the filter half", async () => {
      const response = await readReference();
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        lwql: { enabled: boolean; schema: { views: unknown[] } };
        traceFilter: { fields: unknown[] };
      };
      expect(body.lwql.enabled).toBe(false);
      expect(body.lwql.schema.views).toEqual([]);
      expect(body.traceFilter.fields.length).toBeGreaterThan(0);
    });
  });
});
