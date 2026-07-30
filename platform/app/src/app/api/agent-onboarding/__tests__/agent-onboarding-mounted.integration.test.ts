import { describe, expect, it } from "vitest";

/**
 * The mount itself. Separate from the unit test because importing
 * `api-router` pulls the entire server graph — Prisma, Redis, ClickHouse, OTel
 * — which is far too heavy for the unit shard's `vmThreads` pool (it segfaults
 * it). The unit test covers the service's own routing; this covers the wiring.
 *
 * The service shipped unmounted once, 404ing every endpoint while every check
 * stayed green, because nothing issued a request. A 404 here means the mount
 * regressed; any other status means the route matched.
 */
describe("the agent-onboarding service", () => {
  describe("given the mounted API router", () => {
    it("is registered in api-router, not only exported", async () => {
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
