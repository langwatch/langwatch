/**
 * @vitest-environment node
 * `/api/triggers` over the real REST runtime and the real condition rule.
 * @see specs/automations/authoring-drawer.feature
 */
import type { AutomationApi, Trigger } from "@langwatch/automation-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCanonicalAutomationApp } from "../../app/__tests__/automation-app.fixture.ts";
import { createAutomationRest } from "../automation.rest.ts";
import { mountAutomationRest } from "./automation-rest.harness.ts";

const storedTrigger = {
  id: "trigger_1",
  projectId: "project_1",
  name: "Nightly",
  action: "ADD_TO_ANNOTATION_QUEUE",
  actionParams: { annotators: ["user_owner"], createdByUserId: "user_owner" },
  triggerKind: "AUTOMATION",
  filterQuery: "",
  filters: { topics: ["billing"] },
  active: true,
  message: null,
  alertType: null,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-02T00:00:00.000Z"),
} as unknown as Trigger;

const resources: ReturnType<typeof createCanonicalAutomationApp>["resources"][] = [];

afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
});

/**
 * The family over a stubbed application, except for the two rules under test:
 * the condition a trace automation must keep, and the create that enforces it,
 * both taken from the canonical application so this suite cannot pass against a
 * rule of its own invention.
 */
function mount(options: { live?: Trigger | null } = {}) {
  const fixture = createCanonicalAutomationApp();

  resources.push(fixture.resources);

  const updates: unknown[] = [];
  const app: Partial<AutomationApi> = {
    getAllForProject: async () => [storedTrigger],
    tryGetLiveById: async () => (options.live === undefined ? storedTrigger : options.live),
    assertConditionSurvivesEdit: (input) => fixture.app.assertConditionSurvivesEdit(input),
    createTraceAutomation: (command) => fixture.app.createTraceAutomation(command),
    update: vi.fn(async (command: unknown) => {
      updates.push(command);

      return storedTrigger;
    }),
    delete: vi.fn(async () => undefined),
  };

  return { ...mountAutomationRest(app), app, updates };
}

describe("the /api/triggers declaration", () => {
  it("answers at the five addresses and operations its callers hold", () => {
    const routes = createAutomationRest(() => "https://app.test")
      .router()
      .routes.map((route) => `${route.method.toUpperCase()} ${route.path} ${route.operation}`);

    expect(routes).toEqual([
      "GET / listTriggers",
      "GET /:id getTrigger",
      "POST / createTrigger",
      "PATCH /:id updateTrigger",
      "DELETE /:id deleteTrigger",
    ]);
  });

  it("keeps each route's permission where it has always been", () => {
    const permissions = Object.fromEntries(
      createAutomationRest(() => "https://app.test")
        .router()
        .routes.map((route) => [route.operation, route.permission]),
    );

    expect(permissions).toEqual({
      listTriggers: "triggers:view",
      getTrigger: "triggers:view",
      createTrigger: "triggers:create",
      updateTrigger: "triggers:update",
      deleteTrigger: "triggers:manage",
    });
  });
});

describe("given the REST automation edit", () => {
  describe("when the edit carries delivery settings", () => {
    /** @scenario "A REST edit cannot rewrite an automation's delivery settings" */
    it("refuses the edit with the invalid-action-params code and writes nothing", async () => {
      const api = mount();

      const response = await api.patch("/api/triggers/trigger_1", {
        actionParams: { url: "https://attacker.test/", headers: { Authorization: "secret" } },
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_action_params" });
      expect(api.app.update).not.toHaveBeenCalled();
    });

    /** @scenario "A REST edit cannot re-attribute an automation to another user" */
    it("refuses an edit that renames the annotation queue's creator", async () => {
      const api = mount();

      const response = await api.patch("/api/triggers/trigger_1", {
        actionParams: { annotators: ["user_victim"], createdByUserId: "user_victim" },
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_action_params" });
      expect(api.app.update).not.toHaveBeenCalled();
    });
  });

  describe("when the edit carries only the fields the endpoint documents", () => {
    /** @scenario "A REST edit still changes an automation's name and state" */
    it("applies the edit and forwards no delivery settings", async () => {
      const api = mount();

      const response = await api.patch("/api/triggers/trigger_1", {
        name: "Renamed",
        active: false,
      });

      expect(response.status).toBe(200);
      expect(api.updates).toEqual([
        { id: "trigger_1", projectId: "project_1", name: "Renamed", active: false },
      ]);
    });
  });
});

describe("given the REST automation create", () => {
  describe("when the request omits the condition entirely", () => {
    /** @scenario "The REST API no longer invents an empty condition" */
    it("refuses it with the machine-readable condition-required code", async () => {
      const api = mount();

      const response = await api.post("/api/triggers", {
        name: "No condition",
        action: "SEND_SLACK_MESSAGE",
        actionParams: { slackWebhook: "https://hooks.slack.com/services/abc" },
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "trigger_filters_required" });
    });
  });
});

describe("given a stored automation whose condition is a filter set", () => {
  describe("when a REST patch replaces that condition with an empty one", () => {
    /** @scenario "A REST edit that empties the condition changes nothing" */
    it("refuses with the condition-required code and leaves the stored condition alone", async () => {
      const api = mount();

      const response = await api.patch("/api/triggers/trigger_1", { filters: {} });

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "trigger_filters_required" });
      expect(api.updates).toEqual([]);
    });
  });
});

describe("given an id no live automation in the project has", () => {
  describe("when it is read, edited or deleted", () => {
    it("answers the one sentence this family has always answered a miss with", async () => {
      const api = mount({ live: null });

      for (const response of [
        await api.get("/api/triggers/trigger_gone"),
        await api.patch("/api/triggers/trigger_gone", { name: "Renamed" }),
        await api.delete("/api/triggers/trigger_gone"),
      ]) {
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "Trigger not found" });
      }
    });
  });
});
