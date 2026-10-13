/**
 * @vitest-environment node
 * `/api/triggers` over the real REST runtime and the real public-API service.
 * @see specs/automations/authoring-drawer.feature
 */
import { TriggerAction } from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import { createAutomationRest } from "../automation.rest.ts";
import { createPublicApiRig, triggerRow } from "./automation-rest-redaction.fixture.ts";

const stored = triggerRow({
  id: "trigger_1",
  name: "Nightly",
  action: TriggerAction.ADD_TO_ANNOTATION_QUEUE,
  actionParams: {
    annotators: [{ id: "user_owner", name: "Owner" }],
    createdByUserId: "user_owner",
  },
  filters: { "traces.error": ["true"] },
});

describe("the /api/triggers declaration", () => {
  it("answers at main's addresses and operations", () => {
    const routes = createAutomationRest()
      .router()
      .routes.map((route) => `${route.method.toUpperCase()} ${route.path} ${route.operation}`);

    expect(routes).toEqual([
      "GET / getApiTriggers",
      "GET /:triggerId getApiTriggersById",
      "GET /:triggerId/fires getApiTriggersByIdFires",
      "POST / postApiTriggers",
      "PATCH /:triggerId patchApiTriggersById",
      "POST /:triggerId/enable postApiTriggersByIdEnable",
      "POST /:triggerId/disable postApiTriggersByIdDisable",
      "POST /:triggerId/test-fire postApiTriggersByIdTestFire",
      "DELETE /:triggerId deleteApiTriggersById",
    ]);
  });

  it("keeps each route's permission where main has it", () => {
    const permissions = Object.fromEntries(
      createAutomationRest()
        .router()
        .routes.map((route) => [route.operation, route.permission]),
    );

    expect(permissions).toEqual({
      getApiTriggers: "triggers:view",
      getApiTriggersById: "triggers:view",
      getApiTriggersByIdFires: "triggers:view",
      postApiTriggers: "triggers:create",
      patchApiTriggersById: "triggers:update",
      postApiTriggersByIdEnable: "triggers:update",
      postApiTriggersByIdDisable: "triggers:update",
      postApiTriggersByIdTestFire: "triggers:update",
      deleteApiTriggersById: "triggers:manage",
    });
  });
});

describe("given the REST automation edit", () => {
  describe("when the edit carries delivery settings", () => {
    /** @scenario "A REST edit replaces an automation's delivery settings" */
    it("replaces them", async () => {
      const rig = createPublicApiRig({ rows: [stored] });
      const response = await rig.api.patch("/api/triggers/trigger_1", {
        actionParams: { annotators: [{ id: "user_2", name: "Two" }] },
      });

      expect(response.status).toBe(200);
      expect(rig.rows.get("trigger_1")?.actionParams).toEqual({
        annotators: [{ id: "user_2", name: "Two" }],
      });
    });
  });

  describe("when the edit carries only the fields the endpoint documents", () => {
    /** @scenario "A REST edit still changes an automation's name and state" */
    it("applies the edit and leaves the delivery settings alone", async () => {
      const rig = createPublicApiRig({ rows: [stored] });
      const response = await rig.api.patch("/api/triggers/trigger_1", {
        name: "Renamed",
        active: false,
      });

      expect(await response.json()).toMatchObject({ name: "Renamed", active: false });
      expect(rig.rows.get("trigger_1")?.actionParams).toEqual(stored.actionParams);
    });
  });
});

describe("given the REST automation create", () => {
  describe("when the request omits the condition entirely", () => {
    /** @scenario "The REST API no longer invents an empty condition" */
    it("refuses it with the machine-readable condition-required code", async () => {
      const response = await createPublicApiRig().api.post("/api/triggers", {
        name: "Everything",
        action: "SEND_EMAIL",
        actionParams: { members: ["a@example.com"] },
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "trigger_filters_required" });
    });
  });
});

describe("given a stored automation whose condition is a filter set", () => {
  describe("when a REST patch replaces that condition with an empty one", () => {
    /** @scenario "A REST edit that empties the condition changes nothing" */
    it("refuses with the condition-required code and leaves the stored condition alone", async () => {
      const rig = createPublicApiRig({ rows: [stored] });
      const response = await rig.api.patch("/api/triggers/trigger_1", { filters: {} });

      expect(await response.json()).toMatchObject({ code: "trigger_filters_required" });
      expect(rig.rows.get("trigger_1")?.filters).toEqual(stored.filters);
    });
  });
});

describe("given an id no live automation in the project has", () => {
  describe("when it is read, edited, paused, test-fired or deleted", () => {
    it("answers trigger_not_found", async () => {
      const { api } = createPublicApiRig();

      for (const response of [
        await api.get("/api/triggers/trigger_gone"),
        await api.get("/api/triggers/trigger_gone/fires"),
        await api.patch("/api/triggers/trigger_gone", { name: "Renamed" }),
        await api.post("/api/triggers/trigger_gone/disable"),
        await api.post("/api/triggers/trigger_gone/test-fire"),
        await api.delete("/api/triggers/trigger_gone"),
      ]) {
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: "trigger_not_found" });
      }
    });
  });
});
