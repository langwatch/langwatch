/**
 * @vitest-environment node
 *
 * @see specs/experiments-v3/execution-backend.feature - Hono SSE Endpoint auth
 *
 * Regression guard for the prod incident where the browser workbench got
 * 401 "Authentication required. Use Authorization: Basic ..." on
 * POST /api/experiments/execute.
 *
 * Root cause: the public experiments REST API (GET /api/experiments) and the
 * session-driven execute/abort endpoints share the /api/experiments path but
 * live in two separate Hono apps. The public app applies a project-API-key
 * auth middleware across the whole /api/experiments/* namespace. When it is
 * composed ahead of the execute app, that API-key guard runs first on
 * POST /api/experiments/execute (a request that carries only a browser session
 * cookie, never an API key) and rejects it before the session is checked.
 *
 * This test exercises the real router composition (createApiRouter) so a
 * future reordering or re-introduction of a namespace-wide API-key guard that
 * shadows the session routes fails here.
 */
import { Hono } from "hono";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The execute endpoint authenticates by user session. Force "no session" so
// the request, once it reaches the endpoint, returns the session-layer 401
// ("You must be logged in") rather than proceeding into prisma/orchestrator.
// If the API-key guard wrongly intercepts, we get the API-key 401 instead,
// which is exactly what this test asserts must NOT happen.
vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn().mockResolvedValue(null),
}));

const API_KEY_GUARD_MESSAGE =
  "Authentication required. Use Authorization: Basic base64(projectId:token), Authorization: Bearer <token>, or X-Auth-Token header.";
const SESSION_GUARD_MESSAGE = "You must be logged in to access this endpoint.";

// Minimal body that passes the execute endpoint's zod validation, so routing
// reaches the auth layer rather than short-circuiting at body validation.
const validExecuteBody = {
  projectId: "project_test",
  name: "regression-test",
  dataset: { id: "dataset-1", name: "ds", type: "inline" as const, columns: [] },
  targets: [],
  evaluators: [],
  scope: { type: "full" as const },
};

let router: Hono;

beforeAll(async () => {
  const { createApiRouter } = await import("~/server/api-router");
  router = createApiRouter();
}, 120_000);

describe("POST /api/experiments/execute auth", () => {
  describe("when the request carries a user session but no project API key", () => {
    /** @scenario Browser execution authenticates by user session */
    it("is not rejected by the project API-key guard", async () => {
      const res = await router.request(
        "http://localhost/api/experiments/execute",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validExecuteBody),
        },
      );

      const body = (await res.json()) as { error?: string; message?: string };

      // The API-key guard from the public experiments REST app must never be
      // the thing that answers this request.
      expect(body.message).not.toBe(API_KEY_GUARD_MESSAGE);
      expect(body.error).not.toBe("Unauthorized");
    });
  });

  describe("when the request has neither a session nor an API key", () => {
    /** @scenario Execution endpoint rejects requests with no session */
    it("returns 401 from the session guard telling the user to log in", async () => {
      const res = await router.request(
        "http://localhost/api/experiments/execute",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validExecuteBody),
        },
      );

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe(SESSION_GUARD_MESSAGE);
    });
  });
});

// Mounting the session app first must not steal the public REST list endpoint
// (GET /api/experiments) from the API-key-authenticated experiments app.
describe("GET /api/experiments (public REST list)", () => {
  describe("when the request has no project API key", () => {
    it("is still answered by the project API-key guard", async () => {
      const res = await router.request("http://localhost/api/experiments", {
        method: "GET",
      });

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error?: string; message?: string };
      expect(body.error).toBe("Unauthorized");
      expect(body.message).toBe(API_KEY_GUARD_MESSAGE);
    });
  });
});
