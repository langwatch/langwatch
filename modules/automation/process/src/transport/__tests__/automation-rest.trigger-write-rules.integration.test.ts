/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { createPublicApiRig } from "./automation-rest-redaction.fixture.ts";

const conditions = { "traces.error": ["true"] };

describe("Feature: the API is held to the dashboard's write rules", () => {
  /** @scenario "A delivery configuration its channel does not recognise is refused" */
  it("refuses a delivery configuration the channel cannot read", async () => {
    const response = await createPublicApiRig().api.post("/api/triggers", {
      name: "Dataset",
      action: "ADD_TO_DATASET",
      actionParams: { datasetId: "", datasetMapping: { mapping: {} } },
      filters: conditions,
    });
    expect(await response.json()).toEqual({ error: "invalid_action_params" });
  });

  /** @scenario "A destination that is not https is refused" */
  it("refuses a webhook destination that is not https", async () => {
    const response = await createPublicApiRig().api.post("/api/triggers", {
      name: "Hook",
      action: "SEND_WEBHOOK",
      actionParams: { url: "http://r.example.com/hook" },
      filters: conditions,
    });
    expect(await response.json()).toEqual({ error: "invalid_action_params" });
  });

  /** @scenario "An automation whose only conditions are unsupported is refused" */
  it("refuses conditions naming only unsupported fields", async () => {
    const response = await createPublicApiRig().api.post("/api/triggers", {
      name: "Old",
      action: "SEND_EMAIL",
      actionParams: { members: ["a@example.com"] },
      filters: { "legacy.field": ["x"] },
    });
    expect(await response.json()).toEqual({ error: "trigger_filters_unsupported" });
  });

  /** @scenario "A keyed condition written without its key is refused" */
  it("refuses a keyed condition written without its key", async () => {
    const response = await createPublicApiRig().api.post("/api/triggers", {
      name: "Judge",
      action: "SEND_EMAIL",
      actionParams: { members: ["a@example.com"] },
      filters: { "evaluations.passed": ["false"] },
    });
    expect(await response.json()).toEqual({ error: "trigger_filter_key_required" });
  });

  /** @scenario "An evaluation condition keyed by an evaluator names its monitors" */
  it("refuses a condition keyed by an evaluator", async () => {
    const rig = createPublicApiRig({
      evaluatorIds: ["evaluator_1"],
      monitorsByEvaluator: { evaluator_1: ["monitor_1"] },
    });
    const response = await rig.api.post("/api/triggers", {
      name: "Judge",
      action: "SEND_EMAIL",
      actionParams: { members: ["a@example.com"] },
      filters: { "evaluations.passed": { evaluator_1: ["false"] } },
    });
    expect(await response.json()).toEqual({ error: "trigger_filter_monitor_required" });
  });
});
