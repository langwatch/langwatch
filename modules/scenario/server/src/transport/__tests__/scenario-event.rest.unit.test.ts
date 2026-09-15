import * as observability from "@langwatch/observability";
import type { AppRestBroadcast } from "@langwatch/api/rest";
import type { ScenarioTabRegistry, SimulationService } from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

const logInfo = vi.hoisted(() => vi.fn());

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof observability>()),
  createLogger: () => ({ info: logInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { createScenarioEventsRest, scenarioEventErrorHandler } from "../scenario-event.rest.ts";
import {
  createScenarioRestTestApp,
  createScenarioRestTestRuntime,
  PROJECT_ID,
  scenarioRestTestErrors,
} from "./scenario-rest.harness.ts";

function buildEventFamily(
  options: {
    simulations?: Partial<SimulationService>;
    scenarioTabs?: Partial<ScenarioTabRegistry>;
    broadcast?: Partial<AppRestBroadcast>;
    extractInlineMedia?: (input: {
      event: unknown;
      projectId: string;
      ownerKind: string;
      ownerId: string;
      purpose: string;
    }) => Promise<{ rewrittenEvent: unknown; refs: readonly { id: string }[] }>;
    authenticated?: boolean;
  } = {},
) {
  const world = createScenarioRestTestApp({
    simulations: options.simulations,
    scenarioTabs: options.scenarioTabs,
  });
  const { runtime, projectFacts } = createScenarioRestTestRuntime({
    authenticated: options.authenticated,
  });
  const broadcast = createApiFixture<AppRestBroadcast>(options.broadcast, "REST broadcast");
  const extractInlineMedia =
    options.extractInlineMedia ??
    (async ({ event }) => ({
      rewrittenEvent: event,
      refs: [],
    }));
  const declaration = createScenarioEventsRest({
    simulations: () => world.simulations,
    scenarioTabs: () => world.scenarioTabs,
    broadcast: () => broadcast,
    extractInlineMedia,
    platformUrl: ({ projectSlug, path }) => `https://app.langwatch.test/${projectSlug}${path}`,
  });
  const mounted = runtime.mount(declaration.router(), {
    app: () => world.app,
    onError: scenarioEventErrorHandler(scenarioRestTestErrors),
    facts: [projectFacts],
  });

  return {
    request: (path: string, init?: RequestInit) =>
      mounted.fetch(new Request(`http://api.test${path}`, init)),
  };
}

function deleteEvents(family: ReturnType<typeof buildEventFamily>, query = "") {
  return family.request(`/api/scenario-events${query}`, { method: "DELETE" });
}

function postJson(
  family: ReturnType<typeof buildEventFamily>,
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
      const family = buildEventFamily({ simulations: { getRunIdsForSet } });

      expect((await deleteEvents(family)).status).toBe(422);
      expect(getRunIdsForSet).not.toHaveBeenCalled();
    });

    /** @scenario "DELETE with both scenarioSetId and scenarioRunId is refused" */
    it("refuses two archive scopes", async () => {
      const getRunIdsForSet = vi.fn();
      const family = buildEventFamily({ simulations: { getRunIdsForSet } });

      const response = await deleteEvents(family, "?scenarioSetId=set-a&scenarioRunId=run-a");
      expect(response.status).toBe(422);
      expect(getRunIdsForSet).not.toHaveBeenCalled();
    });

    /** @scenario "DELETE with empty scenarioSetId is refused" */
    it("refuses an empty set id", async () => {
      const getRunIdsForSet = vi.fn();
      const family = buildEventFamily({ simulations: { getRunIdsForSet } });

      expect((await deleteEvents(family, "?scenarioSetId=")).status).toBe(422);
      expect(getRunIdsForSet).not.toHaveBeenCalled();
    });
  });

  describe("when archiving one run", () => {
    /** @scenario "DELETE with scenarioRunId archives exactly that run" */
    it("archives only the project run and reports its id", async () => {
      const deleteRun = vi.fn(async () => {});
      const family = buildEventFamily({
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
      const family = buildEventFamily({
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
      const family = buildEventFamily({
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
      const family = buildEventFamily({
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
      const pending: Array<() => void> = [];
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
      const family = buildEventFamily({
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
      const family = buildEventFamily({
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
      const family = buildEventFamily({
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
      const setPendingNavigate = vi.fn();
      const broadcastToTenant = vi.fn();
      const family = buildEventFamily({
        scenarioTabs: { hasLiveTab: async () => false, setPendingNavigate },
        broadcast: { broadcastToTenant },
      });

      const response = await postJson(family, "/api/scenario-events/browser-tab", {
        tabKey: "tab-a",
        batchRunId: "batch-a",
      });
      await expect(response.json()).resolves.toMatchObject({ delivered: false });
      expect(setPendingNavigate).not.toHaveBeenCalled();
      expect(broadcastToTenant).not.toHaveBeenCalled();
    });

    /** @scenario "The handoff is delivered when a tab is listening" */
    it("parks and broadcasts this instance's run URL", async () => {
      const setPendingNavigate = vi.fn(async () => {});
      const broadcastToTenant = vi.fn(async () => {});
      const family = buildEventFamily({
        scenarioTabs: { hasLiveTab: async () => true, setPendingNavigate },
        broadcast: { broadcastToTenant },
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
      expect(setPendingNavigate).toHaveBeenCalledTimes(1);
      expect(broadcastToTenant).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A handoff never crosses projects" */
    it("uses the authenticated project when checking presence", async () => {
      const hasLiveTab = vi.fn(async () => false);
      const family = buildEventFamily({ scenarioTabs: { hasLiveTab } });

      await postJson(family, "/api/scenario-events/browser-tab", {
        tabKey: "tab-a",
        batchRunId: "batch-a",
      });
      expect(hasLiveTab).toHaveBeenCalledWith({ projectId: PROJECT_ID, tabKey: "tab-a" });
    });

    /** @scenario "The handoff endpoint refuses an unauthenticated caller" */
    it("answers 401 before checking the tab", async () => {
      const hasLiveTab = vi.fn();
      const family = buildEventFamily({
        authenticated: false,
        scenarioTabs: { hasLiveTab },
      });

      const response = await postJson(family, "/api/scenario-events/browser-tab", {
        tabKey: "tab-a",
        batchRunId: "batch-a",
      });
      expect(response.status).toBe(401);
      expect(hasLiveTab).not.toHaveBeenCalled();
    });

    /** @scenario "The handoff URL must belong to this LangWatch instance" */
    it("ignores a caller-supplied URL and broadcasts this instance's URL", async () => {
      const setPendingNavigate = vi.fn(async () => {});
      const broadcastToTenant = vi.fn(async () => {});
      const family = buildEventFamily({
        scenarioTabs: { hasLiveTab: async () => true, setPendingNavigate },
        broadcast: { broadcastToTenant },
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
      expect(setPendingNavigate).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://app.langwatch.test/scenario-rest-project/simulations/default/batch-a",
        }),
      );
      expect(broadcastToTenant).toHaveBeenCalledTimes(1);
    });
  });

  describe("when ingesting inline media", () => {
    /** @scenario "Storage put failure aborts the entire event with a 5xx and no partial state" */
    it("dispatches no event after extraction fails", async () => {
      const messageSnapshot = vi.fn();
      const family = buildEventFamily({
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
      const family = buildEventFamily({
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

function releasePending(pending: Array<() => void>): void {
  const releases = pending.splice(0);
  for (const release of releases) release();
}

function simulationRun(scenarioRunId: string) {
  return {
    scenarioId: "scenario-a",
    batchRunId: "batch-a",
    scenarioRunId,
    status: "SUCCESS" as const,
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
