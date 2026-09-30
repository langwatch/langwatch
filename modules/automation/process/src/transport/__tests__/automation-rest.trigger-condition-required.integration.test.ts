/** @vitest-environment node */
import { TriggerAction } from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import { createPublicApiRig, triggerRow } from "./automation-rest-redaction.fixture.ts";

const email = {
  name: "Errors",
  action: "SEND_EMAIL",
  actionParams: { members: ["a@example.com"] },
} as const;

describe("Feature: an automation over the API always says which traces it is about", () => {
  describe("when the create request omits the condition entirely", () => {
    it("refuses it with the machine-readable condition-required code", async () => {
      const response = await createPublicApiRig().api.post("/api/triggers", email);
      expect(await response.json()).toEqual({ error: "trigger_filters_required" });
    });
  });

  describe("when the create request sends an empty condition", () => {
    it.each([{}, { "traces.error": [] }, { "metadata.value": { env: [] } }])(
      "refuses %o the same way as an omitted one",
      async (filters) => {
        const response = await createPublicApiRig().api.post("/api/triggers", {
          ...email,
          filters,
        });
        expect(await response.json()).toEqual({ error: "trigger_filters_required" });
      },
    );
  });

  describe("when the create request carries a real condition", () => {
    it("creates the automation", async () => {
      const response = await createPublicApiRig().api.post("/api/triggers", {
        ...email,
        filters: { "traces.error": ["true"] },
      });
      expect(response.status).toBe(201);
    });
  });

  describe("when a patch would clear the last condition", () => {
    const row = triggerRow({
      id: "trigger_1",
      action: TriggerAction.SEND_EMAIL,
      actionParams: { members: ["a@example.com"] },
    });

    it("refuses it and leaves the stored condition alone", async () => {
      const rig = createPublicApiRig({ rows: [row] });
      const response = await rig.api.patch("/api/triggers/trigger_1", { filters: {} });

      expect(await response.json()).toEqual({ error: "trigger_filters_required" });
      expect(rig.rows.get("trigger_1")?.filters).toEqual(row.filters);
    });

    it("allows it when a query still narrows the automation", async () => {
      const rig = createPublicApiRig({ rows: [row] });
      const response = await rig.api.patch("/api/triggers/trigger_1", {
        filters: {},
        filterQuery: 'status:"error"',
      });
      expect(response.status).toBe(200);
    });
  });
});
