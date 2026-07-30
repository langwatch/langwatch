import { describe, expect, it } from "vitest";
import { app } from "../[[...route]]/app";

/**
 * The service is a Hono app that only exists once `api-router.ts` mounts it —
 * this repo wires every sub-app explicitly, it does not route by filesystem
 * convention. The first version of this service shipped with a Next.js-style
 * `route.ts` and no mount, so every endpoint 404'd while the whole unit suite,
 * the typecheck and the spec-parity check stayed green: nothing exercised a
 * request path.
 *
 * These tests fail if the mount regresses, without needing a database: they
 * assert against the Hono router itself, and a 404 means "no such route"
 * whereas any other status means the route matched and the handler ran.
 */
describe("the agent-onboarding service", () => {
  describe("given the exported Hono app", () => {
    it.each([
      { method: "POST", path: "/api/agent-onboarding/provision" },
      { method: "GET", path: "/api/agent-onboarding/status" },
      { method: "POST", path: "/api/agent-onboarding/claim/handoff" },
      { method: "POST", path: "/api/agent-onboarding/claim/exchange" },
      { method: "POST", path: "/api/agent-onboarding/claim/direct" },
    ])("routes $method $path", async ({ method, path }) => {
      const res = await app.request(path, {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "POST" ? { body: "{}" } : {}),
      });

      expect(res.status).not.toBe(404);
    });
  });

  describe("given the mounted API router", () => {
    it("is registered in api-router, not only exported", async () => {
      // Importing the router is what proves the wiring: the service reaches
      // requests through `api.route("/", agentOnboardingApp)` and nothing else.
      const { createApiRouter } = await import("~/server/api-router");
      const res = await createApiRouter().request(
        "/api/agent-onboarding/provision",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );

      expect(res.status).not.toBe(404);
    });
  });
});
