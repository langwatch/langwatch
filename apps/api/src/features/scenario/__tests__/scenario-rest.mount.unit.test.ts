import type {
  ScenarioApi,
  ScenarioTabRegistry,
  SimulationService,
} from "@langwatch/scenario-contract";
import type { AppRestBroadcast } from "@langwatch/api/rest";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition.ts";
import { createApiRestRuntime } from "../../../app-rest/api-rest.runtime.ts";
import { mountScenarioEventsRest } from "../scenario-rest.mount.ts";

const PROJECT = {
  id: "project-scenario-rest",
  slug: "scenario-rest",
  teamId: "team-scenario-rest",
  organizationId: "organization-scenario-rest",
};

function testRuntime() {
  const errors = ApiRestObservabilityComposition.create().legacyErrorHandler;

  return {
    errors,
    runtime: createApiRestRuntime({
      projectCredential: async () => ({
        ok: true as const,
        project: { ...PROJECT, isPersonal: false, ownerUserId: null },
        resolved: {
          type: "apiKey" as const,
          apiKeyId: "key-scenario-rest",
          userId: null,
          organizationId: PROJECT.organizationId,
          ingestSourceType: null,
          ingestionTemplateId: null,
          project: { ...PROJECT, isPersonal: false, ownerUserId: null },
        },
        markUsed: () => void 0,
      }),
      organizationCredential: () => {
        throw new Error("This suite opens no organization credential door");
      },
      organizationIdentity: () => {
        throw new Error("This suite opens no organization credential door");
      },
      routeAuthorization: async () => ({ permitted: true, organizationRole: null }),
      errors,
    }),
  };
}

function mountEventFamily() {
  const { runtime, errors } = testRuntime();
  const guardCall = vi.fn();
  const traceUsageGuard: MiddlewareHandler = async (context, next) => {
    guardCall(context.req.path);
    await next();
  };
  const extractInlineMedia = vi.fn(async ({ event }: { event: unknown }) => ({
    rewrittenEvent: event,
    refs: [],
  }));
  const scenarios = createApiFixture<ScenarioApi>({}, "Scenario API");
  const simulations = createApiFixture<SimulationService>(
    {
      messageSnapshot: async () => void 0,
      findScenarioRunData: async () => null,
    },
    "Simulation service",
  );
  const scenarioTabs = createApiFixture<ScenarioTabRegistry>(
    { hasLiveTab: async () => false },
    "Scenario tab registry",
  );
  const broadcast = createApiFixture<AppRestBroadcast>({}, "REST broadcast");
  const mounted = mountScenarioEventsRest(runtime, {
    scenarios: () => scenarios,
    simulations: () => simulations,
    scenarioTabs: () => scenarioTabs,
    broadcast: () => broadcast,
    extractInlineMedia,
    platformUrl: ({ projectSlug, path }) => `https://app.langwatch.test/${projectSlug}${path}`,
    traceUsageGuard,
    errors,
  });

  return {
    extractInlineMedia,
    guardCall,
    request: (path: string, init?: RequestInit) =>
      mounted.fetch(
        new Request(`http://api.test${path}`, {
          ...init,
          headers: { "X-Auth-Token": "test-token", ...init?.headers },
        }),
      ),
  };
}

describe("the scenario-event production mount", () => {
  /** @scenario "Event POST rejects bodies larger than 50MB with 413 before extraction" */
  it("guards only event writes and rejects an oversized event before extraction", async () => {
    const family = mountEventFamily();

    const report = await family.request("/api/scenario-events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(messageSnapshotEvent()),
    });
    expect(report.status).toBe(201);
    expect(family.guardCall).toHaveBeenCalledTimes(1);

    const handoff = await family.request("/api/scenario-events/browser-tab", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabKey: "tab-a", batchRunId: "batch-a" }),
    });
    expect(handoff.status).toBe(200);
    expect(family.guardCall).toHaveBeenCalledTimes(1);

    const archive = await family.request("/api/scenario-events?scenarioRunId=missing", {
      method: "DELETE",
    });
    expect(archive.status).toBe(404);
    expect(family.guardCall).toHaveBeenCalledTimes(2);

    const oversized = await family.request("/api/scenario-events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(50 * 1024 * 1024 + 1),
      },
      body: "{}",
    });
    expect(oversized.status).toBe(413);
    expect(family.guardCall).toHaveBeenCalledTimes(2);
    expect(family.extractInlineMedia).toHaveBeenCalledTimes(1);
  });
});

function messageSnapshotEvent() {
  return {
    type: "SCENARIO_MESSAGE_SNAPSHOT",
    timestamp: 1,
    batchRunId: "batch-a",
    scenarioId: "scenario-a",
    scenarioRunId: "run-a",
    scenarioSetId: "default",
    messages: [{ id: "message-a", role: "user", content: "hello" }],
  };
}
