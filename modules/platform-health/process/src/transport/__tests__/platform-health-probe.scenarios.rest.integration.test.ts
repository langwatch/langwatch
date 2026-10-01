/**
 * @vitest-environment node
 * `/api/health/scenarios` over the real probe and canary, peers scripted per call.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import {
  type ScenarioApi,
  ScenarioRunStatus,
  simulationRunDataSchema,
  Verdict,
} from "@langwatch/scenario-contract";
import { type Suite, suiteSchema, type SuiteApi } from "@langwatch/suite-contract";
import { describe, expect, it, vi } from "vitest";

import { MemorySubsystemProbeChannel } from "../../channels/memory/memory.subsystem-probe.channel.ts";
import { ProjectKeyedProbeService } from "../../services/project-keyed-probe.service.ts";
import { ScenarioCanaryService } from "../../services/scenario-canary.service.ts";
import { SubsystemProbeService } from "../../services/subsystem-probe.service.ts";
import { platformHealthProbeRest } from "../platform-health-probe.rest.ts";

const KEY = "sk-lw-known";
const UNKNOWN_KEYS: Record<string, string>[] = [
  { "X-Auth-Token": "nope" },
  { Authorization: "Bearer nope" },
];

const plan: Suite = suiteSchema.parse({
  id: "plan-1",
  projectId: "project-1",
  name: "Canary",
  slug: "canary",
  kind: "run_plan",
  description: null,
  scenarioIds: ["scenario-1"],
  scope: null,
  targets: [{ type: "prompt", referenceId: "prompt-1" }],
  repeatCount: 1,
  labels: [],
  simulatorModel: null,
  judgeModel: null,
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

function probe() {
  const launchRun = vi.fn(async () => ({
    scheduled: true as const,
    setId: "on-platform",
    batchRunId: "batch-1",
    scenarioRunId: "run-1",
  }));
  const lookups = vi.fn(async ({ projectId }: { projectId: string }) =>
    projectId === plan.projectId ? [plan] : [],
  );
  const scenarioCanary = ScenarioCanaryService.create({
    peers: {
      scenarios: createApiFixture<ScenarioApi>({
        launchRun,
        findScenarioRunData: async () =>
          simulationRunDataSchema.parse({
            scenarioId: "scenario-1",
            batchRunId: "batch-1",
            scenarioRunId: "run-1",
            status: ScenarioRunStatus.SUCCESS,
            results: { verdict: Verdict.SUCCESS, metCriteria: [], unmetCriteria: [] },
            messages: [],
            timestamp: 0,
            durationInMs: 0,
          }),
      }),
      suites: createApiFixture<SuiteApi>({ listByIds: lookups, list: lookups }),
    },
    clock: {
      now: () => 0,
      sleep: async () => undefined,
      raceDeadline: async ({ work }) => ({ value: await work }),
    },
  });
  const service = ProjectKeyedProbeService.create({
    probes: SubsystemProbeService.create({
      collaborators: {
        canaries: MemorySubsystemProbeChannel.create({ answer: () => new Response("{}") }),
        automation: () => ({ findById: async () => null, getRecentFires: async () => [] }),
        workflowExists: async () => false,
      },
    }),
    resolveProject: async ({ token }) => (token === KEY ? "project-1" : null),
    scenarioCanary,
  });
  const hono = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("The probes resolve their own key.");
      },
      identify: () => ({ actor: null, scope: null }),
    },
  }).mount(platformHealthProbeRest.router(), {
    app: () => ({ probeWithProjectKey: (request) => service.probe(request) }),
    onError: canonicalErrorResponse,
  });

  return {
    launchRun,
    lookups,
    get: (query: string, headers: Record<string, string> = {}) =>
      hono.fetch(new Request(`http://api.test/api/health/scenarios${query}`, { headers })),
  };
}

describe("GET /api/health/scenarios", () => {
  describe("when the caller is not a known project", () => {
    /** @scenario "A request with no project API key is refused before any run is queued" */
    it("answers 401 with the sibling probes' sentence and looks nothing up", async () => {
      const { get, launchRun, lookups } = probe();

      const response = await get("?runPlanId=plan-1");

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        message:
          "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.",
      });
      expect(lookups).not.toHaveBeenCalled();
      expect(launchRun).not.toHaveBeenCalled();
    });

    /** @scenario "A request with an unknown project API key is refused before any run is queued" */
    it.each(UNKNOWN_KEYS)("answers 401 Invalid auth token for %o", async (headers) => {
      const { get, launchRun } = probe();

      const response = await get("?runPlanId=plan-1", headers);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ message: "Invalid auth token." });
      expect(launchRun).not.toHaveBeenCalled();
    });
  });

  describe("when the caller holds a project key", () => {
    /** @scenario "An authenticated request triggers a real run through the shared queue path" */
    it("launches the plan's run and answers 200 with its scenarioRunId", async () => {
      const { get, launchRun } = probe();

      const response = await get("?runPlanId=plan-1", { "X-Auth-Token": KEY });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        status: "ok",
        scenarioRunId: "run-1",
        durationMs: 0,
      });
      expect(launchRun).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "project-1", scenarioId: "scenario-1" }),
      );
    });

    /** @scenario "Canary runs are confined to the API key's own project regardless of caller input" */
    it("looks the plan up in the key's project and ignores a projectId query", async () => {
      const { get, lookups } = probe();

      await get("?runPlanId=plan-1&projectId=project-2", { "X-Auth-Token": KEY });

      expect(lookups).toHaveBeenCalled();
      expect(lookups.mock.calls.every(([input]) => input.projectId === "project-1")).toBe(true);
    });

    /** @scenario "A request with no runPlanId is a bad request" */
    it("answers 400 without a runPlanId and queues nothing", async () => {
      const { get, launchRun } = probe();

      const response = await get("", { "X-Auth-Token": KEY });

      expect(response.status).toBe(400);
      expect(launchRun).not.toHaveBeenCalled();
    });

    /** @scenario "A blank runPlanId is a bad request" */
    it.each(["", "%20%20"])("answers 400 for runPlanId=%s and queues nothing", async (blank) => {
      const { get, launchRun } = probe();

      const response = await get(`?runPlanId=${blank}`, { "X-Auth-Token": KEY });

      expect(response.status).toBe(400);
      expect(launchRun).not.toHaveBeenCalled();
    });

    /** @scenario "An implausibly long query parameter is a bad request" */
    it("answers 400 for a runPlanId past 128 characters before any lookup", async () => {
      const { get, launchRun, lookups } = probe();

      const response = await get(`?runPlanId=${"x".repeat(129)}`, { "X-Auth-Token": KEY });

      expect(response.status).toBe(400);
      expect(lookups).not.toHaveBeenCalled();
      expect(launchRun).not.toHaveBeenCalled();
    });
  });

  /** @scenario "The scenario canary route is declared public like its sibling health probes" */
  it("reaches the probe's own key check with the runtime never asked to authenticate", async () => {
    const { get } = probe();

    const scenarios = await get("?runPlanId=plan-1");

    expect(scenarios.status).toBe(401);
    expect(await scenarios.json()).toEqual({
      message:
        "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.",
    });
  });

  /** @scenario "Canary responses are never cacheable" */
  it.each([
    ["an anonymous refusal", "?runPlanId=plan-1", {}],
    ["a bad request", "?runPlanId=%20", { "X-Auth-Token": KEY }],
    ["a healthy run", "?runPlanId=plan-1", { "X-Auth-Token": KEY }],
    ["an unhealthy run", "?runPlanId=missing", { "X-Auth-Token": KEY }],
  ])("answers %s with Cache-Control no-store", async (_name, query, headers) => {
    const response = await probe().get(query, headers);

    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
