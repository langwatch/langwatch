import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { PlanLimitExceededError } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type * as observability from "@langwatch/observability";
import { SimulationRunStatus } from "@langwatch/scenario-contract";
import type { SimulationRunData, SimulationService } from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";

const logInfo = vi.hoisted(() => vi.fn());

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof observability>()),
  createLogger: () => ({ info: logInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import type { ScenarioTabStore } from "../../app/scenario.app.ts";
import type { ScenarioEventBroadcastPublisher } from "../../channels/redis/redis.scenario-event-broadcast.channel.ts";
import { scenarioEventsRest } from "../scenario-event.rest.ts";
import {
  createScenarioRestTestApp,
  createScenarioRestTestRuntime,
  ORGANIZATION_ID,
  PROJECT_ID,
  scenarioRestTestErrors,
} from "./scenario-rest.harness.ts";

async function buildEventFamily(
  options: {
    simulations?: Partial<SimulationService>;
    tabs?: Partial<ScenarioTabStore>;
    redis?: Partial<ScenarioEventBroadcastPublisher>;
    extractInlineMedia?: (input: {
      event: unknown;
      projectId: string;
      ownerKind: string;
      ownerId: string;
      purpose: string;
    }) => Promise<{ rewrittenEvent: unknown; refs: readonly { id: string }[] }>;
    authenticated?: boolean;
    plans?: Partial<EntitlementApi>;
    featureFlags?: Partial<FeatureFlagApi>;
  } = {},
) {
  const world = await createScenarioRestTestApp({
    simulations: options.simulations,
    tabs: options.tabs,
    redis: options.redis,
    plans: options.plans,
    featureFlags: options.featureFlags,
    traces: {
      extractInlineMediaFromEvent:
        options.extractInlineMedia ??
        (async ({ event }) => ({
          rewrittenEvent: event,
          refs: [],
        })),
    },
  });
  const { runtime, projectFacts } = createScenarioRestTestRuntime({
    authenticated: options.authenticated,
  });
  const mounted = runtime.mount(scenarioEventsRest.router(), {
    app: () => world.app,
    onError: scenarioRestTestErrors,
    facts: [projectFacts],
  });

  return {
    request: (path: string, init?: RequestInit) =>
      mounted.fetch(new Request(`http://api.test${path}`, init)),
  };
}

function deleteEvents(family: Awaited<ReturnType<typeof buildEventFamily>>, query = "") {
  return family.request(`/api/scenario-events${query}`, { method: "DELETE" });
}

function postJson(
  family: Awaited<ReturnType<typeof buildEventFamily>>,
  path: string,
  body: Record<string, unknown>,
) {
  return family.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("the scenario-events REST declaration", () => {
  describe("when archive scope is invalid", () => {
    /** @scenario "DELETE without a scope is refused" */
    it("refuses an unscoped archive", async () => {
      const getRunIdsForSet = vi.fn();
      const family = await buildEventFamily({ simulations: { getRunIdsForSet } });

      expect((await deleteEvents(family)).status).toBe(422);
      expect(getRunIdsForSet).not.toHaveBeenCalled();
    });

    /** @scenario "Peer archive calls require exactly one scope" */
    it("gives peer callers the named scope error for absent or ambiguous scope", async () => {
      const world = await createScenarioRestTestApp();

      await expect(
        world.app.archiveScenarioEvents({ projectId: PROJECT_ID }),
      ).rejects.toMatchObject({
        code: "scenario_event_archive_scope_invalid",
      });
      await expect(
        world.app.archiveScenarioEvents({
          projectId: PROJECT_ID,
          scenarioSetId: "set-a",
          scenarioRunId: "run-a",
        }),
      ).rejects.toMatchObject({ code: "scenario_event_archive_scope_invalid" });
    });

    /** @scenario "DELETE with both scenarioSetId and scenarioRunId is refused" */
    it("refuses two archive scopes", async () => {
      const getRunIdsForSet = vi.fn();
      const family = await buildEventFamily({ simulations: { getRunIdsForSet } });

      const response = await deleteEvents(family, "?scenarioSetId=set-a&scenarioRunId=run-a");
      expect(response.status).toBe(422);
      expect(getRunIdsForSet).not.toHaveBeenCalled();
    });

    /** @scenario "DELETE with empty scenarioSetId is refused" */
    it("refuses an empty set id", async () => {
      const getRunIdsForSet = vi.fn();
      const family = await buildEventFamily({ simulations: { getRunIdsForSet } });

      expect((await deleteEvents(family, "?scenarioSetId=")).status).toBe(422);
      expect(getRunIdsForSet).not.toHaveBeenCalled();
    });
  });

  describe("when archiving one run", () => {
    /** @scenario "DELETE with scenarioRunId archives exactly that run" */
    it("archives only the project run and reports its id", async () => {
      const deleteRun = vi.fn(async () => {});
      const family = await buildEventFamily({
        simulations: {
          findScenarioRunData: async () => simulationRun("run-a"),
          deleteRun,
        },
      });

      const response = await deleteEvents(family, "?scenarioRunId=run-a");
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        archived: 1,
        failed: 0,
        scenarioRunId: "run-a",
      });
      expect(deleteRun).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: PROJECT_ID, scenarioRunId: "run-a" }),
      );
    });

    /** @scenario "DELETE with a scenarioRunId the project does not hold is not found" */
    it("answers 404 without dispatching a delete", async () => {
      const deleteRun = vi.fn();
      const family = await buildEventFamily({
        simulations: { findScenarioRunData: async () => null, deleteRun },
      });

      const response = await deleteEvents(family, "?scenarioRunId=missing");
      expect(response.status).toBe(404);
      expect(deleteRun).not.toHaveBeenCalled();
    });
  });

  describe("when archiving one set", () => {
    /** @scenario "Archiving one set leaves runs in other sets untouched" */
    it("dispatches only the ids selected for that set", async () => {
      const deleteRun = vi.fn(async () => {});
      const family = await buildEventFamily({
        simulations: {
          getRunIdsForSet: async () => ({ runIds: ["run-a", "run-b"], reachedCap: false }),
          deleteRun,
        },
      });

      const response = await deleteEvents(family, "?scenarioSetId=set-a");
      await expect(response.json()).resolves.toEqual({
        archived: 2,
        failed: 0,
        scenarioSetId: "set-a",
        hasMore: false,
      });
      expect(deleteRun).toHaveBeenCalledTimes(2);
    });

    it("returns an empty archive result without dispatching deletes", async () => {
      const deleteRun = vi.fn();
      const family = await buildEventFamily({
        simulations: {
          getRunIdsForSet: async () => ({ runIds: [], reachedCap: false }),
          deleteRun,
        },
      });

      const response = await deleteEvents(family, "?scenarioSetId=set-empty");
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        archived: 0,
        failed: 0,
        scenarioSetId: "set-empty",
        hasMore: false,
      });
      expect(deleteRun).not.toHaveBeenCalled();
    });

    it("limits archive deletion concurrency to eight runs", async () => {
      let active = 0;
      let maximumActive = 0;
      const pending: (() => void)[] = [];
      const deleteRun = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            pending.push(() => {
              active -= 1;
              resolve();
            });
          }),
      );
      const family = await buildEventFamily({
        simulations: {
          getRunIdsForSet: async () => ({
            runIds: Array.from({ length: 17 }, (_, index) => `run-${index}`),
            reachedCap: false,
          }),
          deleteRun,
        },
      });

      const responsePromise = deleteEvents(family, "?scenarioSetId=set-a");
      await vi.waitFor(() => expect(deleteRun).toHaveBeenCalledTimes(8));
      expect(maximumActive).toBe(8);

      releasePending(pending);
      await vi.waitFor(() => expect(deleteRun).toHaveBeenCalledTimes(16));
      releasePending(pending);
      await vi.waitFor(() => expect(deleteRun).toHaveBeenCalledTimes(17));
      releasePending(pending);

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ archived: 17, failed: 0 });
      expect(maximumActive).toBe(8);
    });

    /** @scenario "One run failing to archive does not stop the others" */
    it("continues after one delete fails", async () => {
      const deleteRun = vi
        .fn()
        .mockResolvedValueOnce(void 0)
        .mockRejectedValueOnce(new Error("delete failed"))
        .mockResolvedValueOnce(void 0);
      const family = await buildEventFamily({
        simulations: {
          getRunIdsForSet: async () => ({
            runIds: ["run-a", "run-b", "run-c"],
            reachedCap: false,
          }),
          deleteRun,
        },
      });

      const response = await deleteEvents(family, "?scenarioSetId=set-a");
      await expect(response.json()).resolves.toMatchObject({ archived: 2, failed: 1 });
      expect(deleteRun).toHaveBeenCalledTimes(3);
    });

    /** @scenario "Reaching the 10k cap reports hasMore true" */
    it("reports that another archive page remains", async () => {
      const family = await buildEventFamily({
        simulations: {
          getRunIdsForSet: async () => ({ runIds: ["run-a"], reachedCap: true }),
          deleteRun: async () => {},
        },
      });

      const response = await deleteEvents(family, "?scenarioSetId=set-a");
      await expect(response.json()).resolves.toMatchObject({ hasMore: true });
    });
  });

  describe("when offering a browser tab handoff", () => {
    /** @scenario "The handoff is not delivered when no tab is listening" */
    /** @scenario "Nothing is parked when no tab was listening" */
    it("reports undelivered without parking or broadcasting", async () => {
      const setPending = vi.fn();
      const publish = vi.fn(async () => 1);
      const family = await buildEventFamily({
        tabs: { countAfter: async () => 0, setPending },
        redis: { publish },
      });

      const response = await postJson(family, "/api/scenario-events/browser-tab", {
        tabKey: "tab-a",
        batchRunId: "batch-a",
      });
      await expect(response.json()).resolves.toMatchObject({ delivered: false });
      expect(setPending).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });

    /** @scenario "The handoff is delivered when a tab is listening" */
    it("parks and broadcasts this instance's run URL", async () => {
      const calls: string[] = [];
      const setPending = vi.fn(async () => {
        calls.push("park");
      });
      const publish = vi.fn(async () => {
        calls.push("broadcast");
        return 1;
      });
      const family = await buildEventFamily({
        tabs: { countAfter: async () => 1, setPending },
        redis: { publish },
      });

      const response = await postJson(family, "/api/scenario-events/browser-tab", {
        tabKey: "tab-a",
        batchRunId: "batch-a",
        scenarioSetId: "checkout",
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        delivered: true,
        url: "https://app.langwatch.test/scenario-rest-project/simulations/checkout/batch-a",
      });
      expect(setPending).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledTimes(1);
      expect(calls).toEqual(["park", "broadcast"]);
    });

    /** @scenario "A handoff never crosses projects" */
    it("uses the authenticated project when checking presence", async () => {
      const countAfter = vi.fn(async () => 0);
      const family = await buildEventFamily({ tabs: { countAfter } });

      await postJson(family, "/api/scenario-events/browser-tab", {
        tabKey: "tab-a",
        batchRunId: "batch-a",
      });
      expect(countAfter).toHaveBeenCalledWith(
        expect.objectContaining({ key: `scenario_tab:v1:${PROJECT_ID}:tab-a` }),
      );
    });

    /** @scenario "The handoff endpoint refuses an unauthenticated caller" */
    it("answers 401 before checking the tab", async () => {
      const countAfter = vi.fn();
      const family = await buildEventFamily({
        authenticated: false,
        tabs: { countAfter },
      });

      const response = await postJson(family, "/api/scenario-events/browser-tab", {
        tabKey: "tab-a",
        batchRunId: "batch-a",
      });
      expect(response.status).toBe(401);
      expect(countAfter).not.toHaveBeenCalled();
    });

    /** @scenario "The handoff URL must belong to this LangWatch instance" */
    it("ignores a caller-supplied URL and broadcasts this instance's URL", async () => {
      const setPending = vi.fn(async () => {});
      const publish = vi.fn(async () => 1);
      const family = await buildEventFamily({
        tabs: { countAfter: async () => 1, setPending },
        redis: { publish },
      });

      const response = await postJson(family, "/api/scenario-events/browser-tab", {
        tabKey: "tab-a",
        batchRunId: "batch-a",
        url: "https://evil.example/phish",
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        delivered: true,
        url: "https://app.langwatch.test/scenario-rest-project/simulations/default/batch-a",
      });
      expect(setPending).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://app.langwatch.test/scenario-rest-project/simulations/default/batch-a",
        }),
      );
      expect(publish).toHaveBeenCalledTimes(1);
    });
  });

  describe("when ingesting inline media", () => {
    /** @scenario "Storage put failure aborts the entire event with a 5xx and no partial state" */
    it("dispatches no event after extraction fails", async () => {
      const messageSnapshot = vi.fn();
      const family = await buildEventFamily({
        simulations: { messageSnapshot },
        extractInlineMedia: async () => {
          throw new Error("storage unavailable");
        },
      });

      const response = await postJson(family, "/api/scenario-events", messageSnapshotEvent());
      expect(response.status).toBe(500);
      expect(messageSnapshot).not.toHaveBeenCalled();
    });

    /** @scenario "Ingest logs list every stored_objects id extracted for an event" */
    it("logs every externalised object id", async () => {
      logInfo.mockClear();
      const family = await buildEventFamily({
        simulations: { messageSnapshot: async () => {} },
        extractInlineMedia: async ({ event }) => ({
          rewrittenEvent: event,
          refs: [{ id: "stored-a" }, { id: "stored-b" }],
        }),
      });

      const response = await postJson(family, "/api/scenario-events", messageSnapshotEvent());
      expect(response.status).toBe(201);
      const entry = logInfo.mock.calls.find(([context]) =>
        Array.isArray((context as { stored_object_ids?: unknown }).stored_object_ids),
      );
      expect(entry?.[0]).toMatchObject({ stored_object_ids: ["stored-a", "stored-b"] });
    });
  });
});

describe("the scenario-events usage gate", () => {
  const planLimitReached = {
    assertWithinUsageLimit: async () => {
      throw new PlanLimitExceededError("You reached the limit of 1000 traces for this month", {
        currentMonthMessagesCount: 1_000,
        maxMessagesPerMonth: 1_000,
        activePlanName: "Free",
      });
    },
  };

  describe("when the organization spent its monthly allowance", () => {
    /** @scenario "A scenario event past the monthly usage limit is refused" */
    it("refuses the event with the plan limit and dispatches nothing", async () => {
      const messageSnapshot = vi.fn();
      const family = await buildEventFamily({
        simulations: { messageSnapshot },
        plans: planLimitReached,
      });

      const response = await postJson(family, "/api/scenario-events", messageSnapshotEvent());
      expect(response.status).toBe(402);
      await expect(response.json()).resolves.toMatchObject({ error: "ERR_PLAN_LIMIT" });
      expect(messageSnapshot).not.toHaveBeenCalled();
    });

    /** @scenario "Archiving scenario runs past the monthly usage limit is refused" */
    it("refuses the archive with the plan limit and deletes nothing", async () => {
      const deleteRun = vi.fn();
      const family = await buildEventFamily({
        simulations: { findScenarioRunData: async () => simulationRun("run-a"), deleteRun },
        plans: planLimitReached,
      });

      const response = await deleteEvents(family, "?scenarioRunId=run-a");
      expect(response.status).toBe(402);
      expect(deleteRun).not.toHaveBeenCalled();
    });
  });

  describe("when the organization is within its allowance", () => {
    it("asks for the organization the project belongs to", async () => {
      const assertWithinUsageLimit = vi.fn(async () => {});
      const family = await buildEventFamily({
        simulations: { messageSnapshot: async () => {} },
        plans: { assertWithinUsageLimit },
      });

      const response = await postJson(family, "/api/scenario-events", messageSnapshotEvent());
      expect(response.status).toBe(201);
      expect(assertWithinUsageLimit).toHaveBeenCalledWith({ organizationId: ORGANIZATION_ID });
    });
  });
});

describe("the scenario-events links", () => {
  describe("when the project reads Agent Testing", () => {
    /** @scenario "A reported event links to its run set in the interface the project reads" */
    it("answers the external run set under /agent-testing/results", async () => {
      const family = await buildEventFamily({
        simulations: { messageSnapshot: async () => {} },
        featureFlags: { isEnabled: async () => true },
      });

      const response = await postJson(family, "/api/scenario-events", {
        ...messageSnapshotEvent(),
        scenarioSetId: "checkout",
      });
      await expect(response.json()).resolves.toEqual({
        success: true,
        url: "https://app.langwatch.test/scenario-rest-project/agent-testing/results/external:checkout",
      });
    });

    /** @scenario "A browser-tab handoff links to its batch in the interface the project reads" */
    it("hands the batch over under /agent-testing/results", async () => {
      const family = await buildEventFamily({
        tabs: { countAfter: async () => 0 },
        featureFlags: { isEnabled: async () => true },
      });

      const response = await postJson(family, "/api/scenario-events/browser-tab", {
        tabKey: "tab-a",
        batchRunId: "batch-a",
        scenarioSetId: "checkout",
      });
      await expect(response.json()).resolves.toEqual({
        delivered: false,
        url: "https://app.langwatch.test/scenario-rest-project/agent-testing/results/external:checkout/batch-a",
      });
    });
  });

  describe("when the flag cannot be read", () => {
    /** @scenario "A flag read that fails links to the Simulations pages" */
    it("answers the Simulations address", async () => {
      const family = await buildEventFamily({
        simulations: { messageSnapshot: async () => {} },
        featureFlags: {
          isEnabled: async () => {
            throw new Error("flag store unavailable");
          },
        },
      });

      const response = await postJson(family, "/api/scenario-events", messageSnapshotEvent());
      await expect(response.json()).resolves.toEqual({
        success: true,
        url: "https://app.langwatch.test/scenario-rest-project/simulations/default",
      });
    });
  });
});

function releasePending(pending: (() => void)[]): void {
  const releases = pending.splice(0);
  for (const release of releases) release();
}

function simulationRun(scenarioRunId: string): SimulationRunData {
  return {
    scenarioId: "scenario-a",
    batchRunId: "batch-a",
    scenarioRunId,
    status: SimulationRunStatus.SUCCESS,
    metadata: null,
    results: null,
    messages: [],
    timestamp: 1,
    updatedAt: 2,
    durationInMs: 1,
  };
}

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
