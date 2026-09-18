/**
 * Who may read the query reference, and what each of them gets.
 *
 * The document joins two languages that belong to two families. Gating the
 * whole of it on `analytics:view`, the way the rest of this family is gated,
 * would refuse a key scoped to `traces:view` the only document describing the
 * trace filter — a language that key is entitled to use. So the door answers
 * any project credential and the LangWatchQL half is withheld instead.
 * `GET /api/v1/query/schema` refuses such a key outright; this document
 * answers, minus the catalog that door would have refused.
 *
 * The ceiling is mocked rather than reimplemented: what is under test is that
 * the route asks it and shapes the document from the answer, not what the
 * ceiling decides.
 *
 * @see specs/analytics/query-reference.feature
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnforceCeiling = vi.fn();

/** Stands in for the real auth: a project credential is already resolved. */
const stubAuth = async (
  c: { set: (key: string, value: unknown) => void },
  next: () => Promise<void>,
) => {
  c.set("project", { id: "project-123", slug: "p" });
  c.set("resolvedToken", { type: "apiKey" });
  await next();
};

vi.mock("~/server/api-key/auth-middleware", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/server/api-key/auth-middleware")>();
  return { ...actual, enforceApiKeyCeiling: mockEnforceCeiling };
});

vi.mock("~/app/api/middleware/app-context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/app/api/middleware/app-context")>();
  return { ...actual, appFromContext: () => ({}) };
});

vi.mock("~/server/analytics/lwql/access", () => ({
  lwqlEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock("~/server/api/utils", () => ({
  getProtectionsForProject: vi.fn().mockResolvedValue({
    canSeeCosts: true,
    canSeeCapturedInput: true,
    canSeeCapturedOutput: true,
  }),
}));

vi.mock("~/server/db", () => ({ prisma: {} }));

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
    authMiddleware: stubAuth,
    canonicalAuthMiddleware: stubAuth,
    requirePermission: () => async (_c: unknown, next: () => Promise<void>) =>
      next(),
  };
});

const { ApiKeyPermissionDeniedError } = await import("~/server/api-key/errors");
const { registerQueryRoutes } = await import("../[[...route]]/app.v1");
const { createProjectApp } = await import("~/server/api/security");

const secured = createProjectApp({ basePath: "/", errorEnvelope: "canonical" });
registerQueryRoutes(secured);

const testApp = new Hono();
testApp.use("*", async (c, next) => {
  c.set("project" as never, { id: "project-123", slug: "p" });
  c.set("resolvedToken" as never, { type: "apiKey" });
  await next();
});
testApp.route("/", secured.hono);

const readReference = () => testApp.request("http://localhost/reference");

/** What the ceiling really throws when the key does not hold the permission. */
const ceilingRefusal = () => new ApiKeyPermissionDeniedError("analytics:view");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /reference", () => {
  describe("when the key holds analytics:view", () => {
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
        lwql: { enabled: boolean; schema: { datasets: unknown[] } };
        traceFilter: { fields: unknown[] };
      };
      expect(body.lwql.enabled).toBe(true);
      expect(body.lwql.schema.datasets.length).toBeGreaterThan(0);
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
        lwql: { enabled: boolean; schema: { datasets: unknown[] } };
        traceFilter: { fields: unknown[]; syntax: string };
        examples: { language: string; available: boolean }[];
      };
      expect(body.traceFilter.fields.length).toBeGreaterThan(0);
      expect(body.traceFilter.syntax).toContain("trace.attribute.");
      expect(body.lwql.enabled).toBe(false);
      expect(body.lwql.schema.datasets).toEqual([]);
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
});
