/**
 * @vitest-environment node
 *
 * @see specs/scenarios/scenario-canary-healthcheck.feature
 *
 * Route-level proof for `GET /api/health/scenarios`: project API key auth
 * (identical to the sibling health probes) runs and can reject BEFORE any run
 * is queued, a busy probe answers 429, and a healthy/unhealthy
 * outcome from the service maps onto the documented response shape. The
 * service's own retry/budget/single-flight logic is unit-tested against an
 * injected queue/poll boundary in
 * `../../health-probes/__tests__/scenario-canary.service.unit.test.ts` — this
 * file mocks the service's production entrypoint
 * (`runScenarioHealthCanary`) as the one boundary this route crosses, so a
 * queued-run assertion here is "was the entrypoint invoked", never a real
 * queue call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runScenarioHealthCanary, projectFindUnique } = vi.hoisted(() => ({
  runScenarioHealthCanary: vi.fn(),
  projectFindUnique: vi.fn(),
}));

vi.mock("~/server/health-probes/scenario-canary.service", () => ({
  runScenarioHealthCanary,
}));

// The route authenticates exactly like its siblings: the project API key in
// `X-Auth-Token` is resolved through `prisma.project.findUnique`. That lookup
// is the second (and only other) boundary this route crosses.
vi.mock("~/server/db", () => ({
  prisma: { project: { findUnique: projectFindUnique } },
}));

const API_KEY = "scenario-canary-project-api-key";
const PROJECT = { id: "proj-1", apiKey: API_KEY, team: { id: "team-1" } };
const AUTHED = { headers: { "x-auth-token": API_KEY } };

describe("GET /api/health/scenarios", () => {
  beforeEach(() => {
    runScenarioHealthCanary.mockReset();
    projectFindUnique.mockReset();
    projectFindUnique.mockImplementation(
      async ({ where }: { where: { apiKey: string } }) =>
        where.apiKey === API_KEY ? PROJECT : null,
    );
    // Fresh module registry per test so the route's own module-scope state
    // (if any) does not leak between auth/busy/healthy cases.
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function getApp() {
    const mod = await import("../health-checks");
    return mod.app;
  }

  describe("given the route is registered", () => {
    /** @scenario "The scenario canary route is declared public like its sibling health probes" */
    it("declares the scenario canary route as a public endpoint that authenticates the project in-handler, like its siblings", async () => {
      await import("../health-checks");
      const { getRoutePolicy } = await import(
        "~/server/api/security/route-registry"
      );

      const registered = getRoutePolicy("GET", "/api/health/scenarios");
      const sibling = getRoutePolicy("GET", "/api/health/triggers");

      expect(registered?.policy.kind).toBe("public");
      expect(registered?.policy.kind).toBe(sibling?.policy.kind);
    });
  });

  describe("given the request carries no project API key", () => {
    /** @scenario "A request with no project API key is refused before any run is queued" */
    it("responds 401 and queues no scenario run", async () => {
      const app = await getApp();

      const res = await app.request("/api/health/scenarios?runPlanId=plan-1");

      expect(res.status).toBe(401);
      expect(runScenarioHealthCanary).not.toHaveBeenCalled();
      expect(projectFindUnique).not.toHaveBeenCalled();
    });
  });

  describe("given the request carries a project API key that matches no project", () => {
    /** @scenario "A request with an unknown project API key is refused before any run is queued" */
    it.each([
      ["X-Auth-Token", { "x-auth-token": "wrong-key" }],
      ["Authorization: Bearer", { authorization: "Bearer wrong-key" }],
    ])("responds 401 via %s and queues no scenario run", async (_label, headers) => {
      const app = await getApp();

      const res = await app.request("/api/health/scenarios?runPlanId=plan-1", {
        headers,
      });

      expect(res.status).toBe(401);
      expect(runScenarioHealthCanary).not.toHaveBeenCalled();
    });

    it("refuses with the same status and message a sibling health probe gives", async () => {
      const app = await getApp();

      const [canary, sibling] = await Promise.all([
        app.request("/api/health/scenarios?runPlanId=plan-1", {
          headers: { "x-auth-token": "wrong-key" },
        }),
        app.request("/api/health/triggers?triggerId=t-1", {
          headers: { "x-auth-token": "wrong-key" },
        }),
      ]);

      expect(canary.status).toBe(sibling.status);
      expect(await canary.json()).toEqual(await sibling.json());
    });
  });

  describe("given a request carrying a valid project API key", () => {
    /** @scenario "An authenticated request triggers a real run through the shared queue path" */
    it("returns 200 with the queued scenarioRunId when the run is healthy", async () => {
      runScenarioHealthCanary.mockResolvedValue({
        healthy: true,
        scenarioRunId: "canary-run-abc",
        durationMs: 4200,
      });
      const app = await getApp();

      const res = await app.request(
        "/api/health/scenarios?runPlanId=plan-1",
        AUTHED,
      );
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(body).toMatchObject({
        status: "ok",
        scenarioRunId: "canary-run-abc",
        durationMs: 4200,
      });
      expect(runScenarioHealthCanary).toHaveBeenCalledWith({
        projectId: "proj-1",
        runPlanId: "plan-1",
      });
    });

    it.each([
      "timeout",
      "run_failed",
      "judge_failed",
    ] as const)("returns 503 with reason %s when the run is unhealthy", async (reason) => {
      runScenarioHealthCanary.mockResolvedValue({
        healthy: false,
        reason,
        scenarioRunId: "canary-run-abc",
        durationMs: 9000,
      });
      const app = await getApp();

      const res = await app.request(
        "/api/health/scenarios?runPlanId=plan-1",
        AUTHED,
      );
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(503);
      expect(body).toMatchObject({ status: "unhealthy", reason });
    });

    /** @scenario "A concurrent canary while one is in flight starts no second run" */
    it("returns 429 busy when the probe reports it is already in flight", async () => {
      runScenarioHealthCanary.mockResolvedValue({ busy: true });
      const app = await getApp();

      const res = await app.request(
        "/api/health/scenarios?runPlanId=plan-1",
        AUTHED,
      );
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(429);
      expect(body).toMatchObject({ status: "busy" });
    });

    /** @scenario "A request with no runPlanId is a bad request" */
    it("responds 400 and queues no run when runPlanId is absent", async () => {
      const app = await getApp();

      const res = await app.request("/api/health/scenarios", AUTHED);

      expect(res.status).toBe(400);
      // A missing pointer is a bad request, distinct from the 503 a plan that
      // does not resolve reports — the probe is never even invoked.
      expect(runScenarioHealthCanary).not.toHaveBeenCalled();
    });

    /** @scenario "A blank runPlanId is a bad request" */
    it.each([
      ["empty", "?runPlanId="],
      ["whitespace-only", "?runPlanId=%20%20"],
    ])("responds 400 and queues no run when runPlanId is %s", async (_label, query) => {
      const app = await getApp();

      const res = await app.request(`/api/health/scenarios${query}`, AUTHED);

      expect(res.status).toBe(400);
      expect(runScenarioHealthCanary).not.toHaveBeenCalled();
    });

    /** @scenario "Canary responses are never cacheable" */
    it.each([
      [
        200,
        { healthy: true, scenarioRunId: "canary-run-abc", durationMs: 1000 },
      ],
      [
        503,
        {
          healthy: false,
          reason: "run_failed",
          scenarioRunId: "canary-run-abc",
          durationMs: 9000,
        },
      ],
    ])("sets Cache-Control no-store on a %s", async (status, result) => {
      runScenarioHealthCanary.mockResolvedValue(result);
      const app = await getApp();

      const res = await app.request(
        "/api/health/scenarios?runPlanId=plan-1",
        AUTHED,
      );

      expect(res.status).toBe(status);
      expect(res.headers.get("cache-control")).toBe("no-store");
    });

    /** @scenario "Canary responses are never cacheable" */
    it("sets Cache-Control no-store on an auth refusal too", async () => {
      const app = await getApp();

      const res = await app.request("/api/health/scenarios?runPlanId=plan-1");

      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("no-store");
    });

    /** @scenario "Canary runs are confined to the API key's own project regardless of caller input" */
    it("scopes the run plan lookup to the key's project, ignoring any projectId on the query string", async () => {
      runScenarioHealthCanary.mockResolvedValue({
        healthy: true,
        scenarioRunId: "canary-run-abc",
        durationMs: 1000,
      });
      const app = await getApp();

      await app.request(
        "/api/health/scenarios?runPlanId=plan-1&projectId=someone-elses-project",
        AUTHED,
      );

      // The project is the one the API key resolved to. Confinement is enforced
      // one layer down: the plan is looked up scoped to that project, so a
      // runPlanId owned by another project resolves to nothing and no run is
      // launched (proven in the service unit test).
      expect(runScenarioHealthCanary).toHaveBeenCalledWith({
        projectId: "proj-1",
        runPlanId: "plan-1",
      });
    });

    /** @scenario "An implausibly long query parameter is a bad request" */
    it("responds 400 and queues no run when runPlanId is longer than 128 characters", async () => {
      const app = await getApp();
      const tooLong = "p".repeat(129);

      const res = await app.request(
        `/api/health/scenarios?runPlanId=${tooLong}`,
        AUTHED,
      );
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(400);
      expect(body).toMatchObject({
        message: "runPlanId query parameter is invalid.",
      });
      expect(runScenarioHealthCanary).not.toHaveBeenCalled();
    });
  });
});
