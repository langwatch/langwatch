/**
 * One request, one request-log record.
 *
 * Twenty-one families mount at the `/api` base path, so every one of their
 * app-level middlewares matches `/api/prompts` and the process wrote up to
 * twenty-one identical `request handled` lines for a single request — same
 * trace id, same millisecond, different span. Finding F5 of
 * `dev/docs/plans/e2e-walk-2026-09-04.md`.
 *
 * @see specs/observability/one-request-one-log-record.feature
 */
import { Hono, type MiddlewareHandler } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RestApiServicePorts } from "../security/rest-api-service.js";

const logRecords: {
  level: string;
  payload: Record<string, unknown>;
  message: string;
}[] = [];

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langwatch/observability")>();
  const record = (level: string) => (payload: Record<string, unknown>, message: string) => {
    logRecords.push({ level, payload, message });
  };
  return {
    ...actual,
    createLogger: () => ({
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
      debug: record("debug"),
    }),
  };
});

const { publicEndpoint } = await import("../../access-policy.js");
const { loggerMiddleware } = await import("../middleware.js");
const { createRestApiService } = await import("../security/rest-api-service.js");

const passThrough: MiddlewareHandler = async (_c, next) => next();

function spine() {
  const ports: RestApiServicePorts = {
    appContext: passThrough,
    // The real process installs the same middleware on every family, which is
    // the whole point: the first to run owns the record.
    requestLogger: () => loggerMiddleware({ name: "rest" }),
    requestTracer: () => passThrough,
    legacyErrorHandler: (error, c) => c.json({ error: error.message }, 500),
    canonicalErrorHandler: (error, c) => c.json({ error: { message: error.message } }, 500),
    authenticateProject: () => passThrough,
    authorizeProjectPermission: () => passThrough,
    authorizeApiKeyCeiling: () => passThrough,
    authenticateOrganization: () => passThrough,
    authorizeOrganizationPermission: () => passThrough,
    authorizeRouteTeamPermission: () => passThrough,
    authorizeRouteProjectPermission: () => passThrough,
    authenticateOrganizationThrowing: passThrough,
    authorizeOrganizationPermissionThrowing: () => passThrough,
  };
  return createRestApiService<object, object>(ports);
}

/** Three families at one base path, mounted the way the process mounts them. */
function threeFamiliesAtOneBasePath(): Hono {
  const service = spine();
  const root = new Hono();
  for (const family of ["collector", "prompts", "annotations"]) {
    const app = service.createServiceApp({ basePath: "/api" });
    app
      .access(publicEndpoint("framework test endpoint"))
      .get(`/${family}`, (c) => c.json({ family }));
    root.route("/", app.hono);
  }
  return root;
}

const handledRecords = () => logRecords.filter((r) => r.message === "request handled");

beforeEach(() => {
  logRecords.length = 0;
});

describe("given three families mounted at the same base path", () => {
  describe("when one request arrives", () => {
    /** @scenario "One request writes one request-log record" */
    it("writes exactly one request-log record", async () => {
      const root = threeFamiliesAtOneBasePath();

      const response = await root.request("/api/prompts");

      expect(response.status).toBe(200);
      expect(handledRecords()).toHaveLength(1);
    });

    /** @scenario "The request-log record names the endpoint that answered" */
    it("names the family and the endpoint the request resolved to", async () => {
      const root = threeFamiliesAtOneBasePath();

      await root.request("/api/prompts");

      const payload = handledRecords()[0]?.payload;
      expect(payload?.route).toBe("GET /api/prompts");
      expect(payload?.family).toBe("api");
      expect(payload?.url).toBe("/api/prompts");
      expect(payload?.statusCode).toBe(200);
    });
  });
});
