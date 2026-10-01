/** @vitest-environment node */
import { TriggerAction } from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import {
  createPublicApiRig,
  SECRET_ROWS,
  SECRETS,
  triggerRow,
  readFirePage,
  readTrigger,
} from "./automation-rest-redaction.fixture.ts";

const rule = {
  threshold: 5,
  operator: "gt",
  timePeriod: 60,
  seriesName: "0/trace_id/cardinality",
} as const;
const conditions = { "traces.error": ["true"] };
const emailRow = triggerRow({
  id: "trigger_1",
  action: TriggerAction.SEND_EMAIL,
  actionParams: { members: ["a@example.com"] },
});

function withFires(count: number) {
  const rig = createPublicApiRig({ rows: [emailRow] });
  for (let index = 0; index < count; index++) {
    rig.store.fires.push({
      id: `fire_${String(index).padStart(2, "0")}`,
      projectId: "project_1",
      triggerId: "trigger_1",
      customGraphId: null,
      // Two fires share each millisecond, so a page boundary can land inside a burst.
      createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, 0, Math.floor(index / 2))),
      resolvedAt: null,
    });
  }
  return rig;
}

describe("Feature: automations over the public API express what the dashboard expresses", () => {
  describe("when the four routes #6900 added are called", () => {
    it.each(["/api/triggers", "/api/v1/triggers"])(
      "answers each of them under %s",
      async (base) => {
        const rig = createPublicApiRig({ rows: [emailRow] });

        expect((await rig.api.get(`${base}/trigger_1/fires`)).status).toBe(200);
        expect((await rig.api.post(`${base}/trigger_1/disable`)).status).toBe(200);
        expect((await rig.api.post(`${base}/trigger_1/enable`)).status).toBe(200);
        expect((await rig.api.post(`${base}/trigger_1/test-fire`)).status).toBe(200);
      },
    );
  });

  describe("when an alert on a graph is created over the API", () => {
    /** @scenario "A graph alert created via the API renders in the UI" */
    it("stores the row the dashboard hydrates its alert from", async () => {
      const rig = createPublicApiRig({ graphIds: ["graph_1"] });
      const response = await rig.api.post("/api/triggers", {
        name: "Latency",
        action: "SEND_EMAIL",
        actionParams: { members: ["a@example.com"] },
        customGraphId: "graph_1",
        graphAlert: rule,
        alertType: "WARNING",
      });
      const body = await readTrigger(response);

      expect(response.status).toBe(201);
      expect(body).toMatchObject({ kind: "ALERT", customGraphId: "graph_1", graphAlert: rule });
      expect(body.actionParams).toEqual({ members: ["a@example.com"] });
      expect(rig.rows.get(body.id)).toMatchObject({
        triggerKind: "ALERT",
        actionParams: expect.objectContaining(rule),
      });
    });

    /** @scenario "An alert on a graph from another project is refused" */
    it("refuses an alert on a graph this project does not have", async () => {
      const response = await createPublicApiRig().api.post("/api/triggers", {
        name: "Latency",
        action: "SEND_EMAIL",
        actionParams: { members: ["a@example.com"] },
        customGraphId: "graph_other",
        graphAlert: rule,
        alertType: "WARNING",
      });
      expect(await response.json()).toMatchObject({ code: "graph_not_found" });
    });
  });

  describe("when an automation states templates, cadence and a trace query", () => {
    /** @scenario "The upsert shape is expressible over the API" */
    it("saves each of them onto the row", async () => {
      const rig = createPublicApiRig();
      const body = await readTrigger(
        await rig.api.post("/api/triggers", {
          name: "Errors",
          action: "SEND_EMAIL",
          actionParams: { members: ["a@example.com"] },
          filterQuery: '  status:"error"  ',
          templates: { emailSubjectTemplate: "{{ trigger.name }}" },
          notificationCadence: "hourly_digest",
          traceDebounceMs: 5000,
        }),
      );

      expect(body).toMatchObject({
        filterQuery: 'status:"error"',
        traceDebounceMs: 5000,
        templates: { emailSubjectTemplate: "{{ trigger.name }}" },
      });
    });

    /** @scenario "A trace query the platform cannot read is refused" */
    it("refuses a query it cannot read", async () => {
      const response = await createPublicApiRig().api.post("/api/triggers", {
        name: "Errors",
        action: "SEND_EMAIL",
        actionParams: { members: ["a@example.com"] },
        filterQuery: "((",
      });
      const body = await response.json();
      expect(body).toMatchObject({ code: "trigger_filter_query_invalid" });
      expect(JSON.stringify(body)).not.toContain("traces.attributes");
    });
  });

  describe("when a report's stored configuration can no longer be read", () => {
    /** @scenario "A report with nothing readable to send says what to state" */
    it("asks for the report rather than for a different channel", async () => {
      const rig = createPublicApiRig({
        rows: [
          triggerRow({
            id: "trigger_r",
            action: TriggerAction.SEND_EMAIL,
            triggerKind: "REPORT",
            actionParams: { members: ["a@example.com"] },
          }),
        ],
      });
      const response = await rig.api.patch("/api/triggers/trigger_r", {
        actionParams: { members: ["b@example.com"] },
      });
      expect(await response.json()).toMatchObject({ code: "report_incomplete" });
    });
  });

  describe("when a delivery configuration names a field the channel has not", () => {
    /** @scenario "A field the channel does not have is refused, not dropped" */
    it("refuses the create", async () => {
      const response = await createPublicApiRig().api.post("/api/triggers", {
        name: "Errors",
        action: "SEND_EMAIL",
        actionParams: { members: ["a@example.com"], slackWebhook: SECRETS.webhookUrl },
        filters: conditions,
      });
      expect(await response.json()).toMatchObject({ code: "trigger_action_params_unknown_fields" });
    });

    /** @scenario "Another channel's field cannot be parked on this one" */
    it("refuses an update carrying a field from a different channel", async () => {
      const rig = createPublicApiRig({ rows: [emailRow] });
      const response = await rig.api.patch("/api/triggers/trigger_1", {
        actionParams: { members: ["a@example.com"], url: "https://r.example.com" },
      });
      expect(await response.json()).toMatchObject({ code: "trigger_action_params_unknown_fields" });
      expect(rig.rows.get("trigger_1")?.actionParams).toEqual(emailRow.actionParams);
    });
  });

  describe("when an alert's rule is sent inside its delivery configuration", () => {
    const alert = triggerRow({
      id: "trigger_alert",
      action: TriggerAction.SEND_EMAIL,
      triggerKind: "ALERT",
      customGraphId: "graph_1",
      actionParams: { members: ["a@example.com"], ...rule },
    });

    /** @scenario "A rule sent in the delivery configuration is refused" */
    it("says where the rule belongs rather than ignoring it", async () => {
      const response = await createPublicApiRig({ rows: [alert] }).api.patch(
        "/api/triggers/trigger_alert",
        {
          actionParams: { members: ["a@example.com"], threshold: 9 },
        },
      );
      expect(await response.json()).toMatchObject({ code: "trigger_rule_fields_misplaced" });
    });

    /** @scenario "The read states the rule where a write states it" */
    it("hands the rule back in its own field, not in the delivery configuration", async () => {
      const body = await readTrigger(
        await createPublicApiRig({ rows: [alert] }).api.get("/api/triggers/trigger_alert"),
      );
      expect(body.graphAlert).toEqual(rule);
      expect(body.actionParams).not.toHaveProperty("threshold");
    });

    /** @scenario "The rule an automation fires by still survives a save" */
    it("keeps the stored rule when only the delivery changes", async () => {
      const rig = createPublicApiRig({ rows: [alert] });
      await rig.api.patch("/api/triggers/trigger_alert", {
        actionParams: { members: ["b@example.com"] },
      });
      expect(rig.rows.get("trigger_alert")?.actionParams).toEqual({
        members: ["b@example.com"],
        ...rule,
      });
    });
  });

  describe("when a project test-fires more often than a minute allows", () => {
    /** @scenario "Test fires are capped per project" */
    it("declines once the window's count is spent", async () => {
      const rig = createPublicApiRig({ rows: [emailRow] });
      rig.limits.count.mockResolvedValueOnce({ allowed: false, resetAt: Date.now() + 30_000 });
      const response = await rig.api.post("/api/triggers/trigger_1/test-fire");

      expect(await response.json()).toMatchObject({ code: "trigger_test_fire_rate_limited" });
      expect(rig.limits.count).toHaveBeenCalledWith(
        expect.objectContaining({ key: "testfire:project:project_1", max: 10 }),
      );
    });

    /** @scenario "A Slack test fire is not capped" */
    it("keeps sending to a destination pinned to Slack", async () => {
      const rig = createPublicApiRig({ rows: [SECRET_ROWS.slackLegacyWebhook] });
      await rig.api.post("/api/triggers/trigger_slack/test-fire");
      expect(rig.limits.count).not.toHaveBeenCalled();
    });
  });

  describe("when an automation is test-fired over the API", () => {
    /** @scenario "API test-fire delivers to the automation's own destination" */
    it("sends to the destination the automation is saved with", async () => {
      const rig = createPublicApiRig({ rows: [emailRow] });
      const response = await rig.api.post("/api/triggers/trigger_1/test-fire", {
        recipients: ["x@evil.example"],
      });

      expect(response.status).toBe(200);
      expect(rig.testFire).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "email", recipients: ["a@example.com"] }),
      );
    });

    it("test-fires a webhook Slack automation through its webhook, never the bot API", async () => {
      const rig = createPublicApiRig({ rows: [SECRET_ROWS.slackLegacyWebhook] });
      await rig.api.post("/api/triggers/trigger_slack/test-fire");
      expect(rig.testFire).toHaveBeenCalledWith(
        expect.objectContaining({ webhook: SECRETS.webhookUrl }),
      );
    });

    /** @scenario "A test fire with nothing to deliver to says so" */
    it("declines when the automation writes a record rather than sending", async () => {
      const rig = createPublicApiRig({
        rows: [
          triggerRow({
            id: "trigger_ds",
            action: TriggerAction.ADD_TO_DATASET,
            actionParams: { datasetId: "d" },
          }),
        ],
      });
      expect(await (await rig.api.post("/api/triggers/trigger_ds/test-fire")).json()).toMatchObject(
        {
          code: "test_fire_unavailable",
        },
      );
    });
  });

  describe("when an automation's fires are read over the API", () => {
    /** @scenario "Fire history is readable over the API" */
    it("answers with what it has done, newest first, metadata only", async () => {
      const body = await readFirePage(await withFires(3).api.get("/api/triggers/trigger_1/fires"));

      expect(body.fires.map((fire) => fire.id)).toEqual(["fire_02", "fire_01", "fire_00"]);
      expect(Object.keys(body.fires[0] ?? {}).toSorted()).toEqual([
        "customGraphId",
        "firedAt",
        "id",
        "resolvedAt",
        "triggerId",
      ]);
      expect(body.nextCursor).toBeNull();
    });

    /** @scenario "Fire history pages over the API" */
    it("walks back a page at a time with the cursor it hands out", async () => {
      const { api } = withFires(5);
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const query: string = cursor ? `?limit=2&cursor=${cursor}` : "?limit=2";
        const page = await readFirePage(await api.get(`/api/triggers/trigger_1/fires${query}`));
        seen.push(...page.fires.map((fire) => fire.id));
        cursor = page.nextCursor;
      } while (cursor);

      expect(seen).toEqual(["fire_04", "fire_03", "fire_02", "fire_01", "fire_00"]);
    });

    it("refuses a cursor it did not issue", async () => {
      const response = await withFires(1).api.get(
        "/api/triggers/trigger_1/fires?cursor=not-a-cursor",
      );
      expect(response.status).toBe(422);
    });
  });

  describe("when an automation is paused and resumed over the API", () => {
    /** @scenario "Pausing and resuming round-trips over the API" */
    it("answers with the state it is in each time", async () => {
      const { api } = createPublicApiRig({ rows: [emailRow] });
      expect(await (await api.post("/api/triggers/trigger_1/disable")).json()).toMatchObject({
        active: false,
      });
      expect(await (await api.post("/api/triggers/trigger_1/enable")).json()).toMatchObject({
        active: true,
      });
    });
  });

  describe("when a webhook automation is pointed at a new destination", () => {
    /** @scenario "Retargeting and re-stating the header values succeeds in one call" */
    it("saves the new destination and the values sent with it", async () => {
      const rig = createPublicApiRig({ rows: [SECRET_ROWS.webhook] });
      const response = await rig.api.patch("/api/triggers/trigger_webhook", {
        actionParams: {
          url: "https://new.example.com/hook",
          headers: { Authorization: "Bearer new" },
          signingSecret: null,
        },
      });
      expect(response.status).toBe(200);
      expect(rig.rows.get("trigger_webhook")?.actionParams.url).toBe(
        "https://new.example.com/hook",
      );
    });

    /** @scenario "Retargeting while keeping the stored header values is refused" */
    it("says the values have to travel with the new destination", async () => {
      const response = await createPublicApiRig({ rows: [SECRET_ROWS.webhook] }).api.patch(
        "/api/triggers/trigger_webhook",
        {
          actionParams: {
            url: "https://new.example.com/hook",
            headers: { Authorization: "[redacted]" },
          },
        },
      );
      expect(await response.json()).toMatchObject({ code: "webhook_header_values_required" });
    });

    /** @scenario "Retargeting while keeping the stored signing secret is refused" */
    it("names the signing secret as what has to travel", async () => {
      const response = await createPublicApiRig({ rows: [SECRET_ROWS.webhook] }).api.patch(
        "/api/triggers/trigger_webhook",
        {
          actionParams: { url: "https://new.example.com/hook", signingSecret: "[redacted]" },
        },
      );
      expect(await response.json()).toMatchObject({ code: "invalid_action_params" });
    });
  });

  describe("when an update names a different delivery channel", () => {
    /** @scenario "The delivery channel cannot be changed over the API" */
    it("refuses the save rather than ignoring the field", async () => {
      const response = await createPublicApiRig({ rows: [emailRow] }).api.patch(
        "/api/triggers/trigger_1",
        {
          action: "SEND_SLACK_MESSAGE",
        },
      );
      expect(await response.json()).toMatchObject({ code: "trigger_action_immutable" });
    });
  });

  describe("when an update would turn an automation into a different kind", () => {
    /** @scenario "An automation cannot become an alert over the API" */
    it("refuses the save", async () => {
      const response = await createPublicApiRig({ rows: [emailRow] }).api.patch(
        "/api/triggers/trigger_1",
        {
          graphAlert: rule,
        },
      );
      expect(await response.json()).toMatchObject({ code: "trigger_kind_immutable" });
    });
  });
});
