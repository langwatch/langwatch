/**
 * @vitest-environment node
 *
 * @see specs/scenarios/scenario-canary-healthcheck.feature
 *
 * Route-level proof for `GET /api/health/scenarios`: auth runs and can reject
 * BEFORE any run is queued, a busy probe answers 429, and a healthy/unhealthy
 * outcome from the service maps onto the documented response shape. The
 * service's own retry/budget/single-flight logic is unit-tested against an
 * injected queue/poll boundary in
 * `../../health-probes/__tests__/scenario-canary.service.unit.test.ts` — this
 * file mocks the service's production entrypoint
 * (`runScenarioHealthCanary`) as the one boundary this route crosses, so a
 * queued-run assertion here is "was the entrypoint invoked", never a real
 * queue call.
 *
 * This file is expected to fail until GET /api/health/scenarios exists on
 * src/server/routes/health-checks.ts and
 * src/server/health-probes/scenario-canary.service.ts exports
 * `runScenarioHealthCanary`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runScenarioHealthCanary } = vi.hoisted(() => ({
  runScenarioHealthCanary: vi.fn(),
}));

vi.mock("~/server/health-probes/scenario-canary.service", () => ({
  runScenarioHealthCanary,
}));

const SECRET = "scenario-canary-integration-secret";

describe("GET /api/health/scenarios", () => {
  let original: string | undefined;

  beforeEach(async () => {
    original = process.env.CRON_API_KEY;
    process.env.CRON_API_KEY = SECRET;
    runScenarioHealthCanary.mockReset();
    // Fresh module registry per test so the route's own module-scope state
    // (if any) does not leak between auth/busy/healthy cases.
    vi.resetModules();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CRON_API_KEY;
    else process.env.CRON_API_KEY = original;
  });

  async function getApp() {
    const mod = await import("../health-checks");
    return mod.app;
  }

  describe("access policy declaration", () => {
    /** @scenario "The scenario canary route is declared internal-secret, never public" */
    it("declares the scenario canary route as internalSecret so the OpenAPI spec never advertises this LLM-spend endpoint as unauthenticated", async () => {
      // The handler gates in-handler on validateInternalSecret, so its declared
      // access policy must be `internal`. A `public` declaration would document
      // a real-run, LLM-spend endpoint as needing no auth. Registering the app
      // populates the process-wide route registry as a side effect.
      await import("../health-checks");
      const { getRoutePolicy } = await import(
        "~/server/api/security/route-registry"
      );

      const registered = getRoutePolicy("GET", "/api/health/scenarios");

      expect(registered?.policy.kind).toBe("internal");
      expect(registered?.policy.kind).not.toBe("public");
    });
  });

  describe("given the request carries no Authorization header", () => {
    /** @scenario "A request with no auth secret is refused before any run is queued" */
    it("responds 401", async () => {
      const app = await getApp();

      const res = await app.request("/api/health/scenarios");

      expect(res.status).toBe(401);
    });

    /** @scenario "A request with no auth secret is refused before any run is queued" */
    it("queues no scenario run", async () => {
      const app = await getApp();

      await app.request("/api/health/scenarios");

      expect(runScenarioHealthCanary).not.toHaveBeenCalled();
    });
  });

  describe("given the request carries a bearer token that does not match the configured secret", () => {
    /** @scenario "A request with the wrong auth secret is refused before any run is queued" */
    it("responds 403", async () => {
      const app = await getApp();

      const res = await app.request("/api/health/scenarios", {
        headers: { authorization: "Bearer wrong-secret" },
      });

      expect(res.status).toBe(403);
    });

    /** @scenario "A request with the wrong auth secret is refused before any run is queued" */
    it("queues no scenario run", async () => {
      const app = await getApp();

      await app.request("/api/health/scenarios", {
        headers: { authorization: "Bearer wrong-secret" },
      });

      expect(runScenarioHealthCanary).not.toHaveBeenCalled();
    });
  });

  describe("given a request carrying the correct internal secret", () => {
    /** @scenario "An authenticated request triggers a real run through the shared queue path" */
    it("returns 200 with the queued scenarioRunId when the run is healthy", async () => {
      runScenarioHealthCanary.mockResolvedValue({
        healthy: true,
        scenarioRunId: "canary-run-abc",
        durationMs: 4200,
      });
      const app = await getApp();

      const res = await app.request("/api/health/scenarios", {
        headers: { authorization: `Bearer ${SECRET}` },
      });
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(body).toMatchObject({
        status: "ok",
        scenarioRunId: "canary-run-abc",
        durationMs: 4200,
      });
    });

    it.each(["timeout", "run_failed", "judge_failed"] as const)(
      "returns 503 with reason %s when the run is unhealthy",
      async (reason) => {
        runScenarioHealthCanary.mockResolvedValue({
          healthy: false,
          reason,
          scenarioRunId: "canary-run-abc",
          durationMs: 9000,
        });
        const app = await getApp();

        const res = await app.request("/api/health/scenarios", {
          headers: { authorization: `Bearer ${SECRET}` },
        });
        const body = (await res.json()) as Record<string, unknown>;

        expect(res.status).toBe(503);
        expect(body).toMatchObject({ status: "unhealthy", reason });
      },
    );

    /** @scenario "A concurrent canary while one is in flight starts no second run" */
    it("returns 429 busy when the probe reports it is already in flight", async () => {
      runScenarioHealthCanary.mockResolvedValue({ busy: true });
      const app = await getApp();

      const res = await app.request("/api/health/scenarios", {
        headers: { authorization: `Bearer ${SECRET}` },
      });
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(429);
      expect(body).toMatchObject({ status: "busy" });
    });

    /** @scenario "Canary runs are confined to the dedicated canary project regardless of caller input" */
    it("invokes the canary entrypoint with no caller-supplied project id, however the request is shaped", async () => {
      runScenarioHealthCanary.mockResolvedValue({
        healthy: true,
        scenarioRunId: "canary-run-abc",
        durationMs: 1000,
      });
      const app = await getApp();

      await app.request(
        "/api/health/scenarios?projectId=some-customer-project-id",
        { headers: { authorization: `Bearer ${SECRET}` } },
      );

      // The entrypoint takes no arguments at all — the canary project id is
      // resolved entirely from server-side config, never from the request,
      // so no query/body value can redirect a canary run into a customer
      // project.
      expect(runScenarioHealthCanary).toHaveBeenCalledWith();
    });
  });
});
