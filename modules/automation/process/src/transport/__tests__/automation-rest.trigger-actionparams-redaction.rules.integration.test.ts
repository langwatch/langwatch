/** @vitest-environment node */
import { TriggerAction } from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import {
  createPublicApiRig,
  triggerRow,
  readTrigger,
} from "./automation-rest-redaction.fixture.ts";

const rule = {
  threshold: 5,
  operator: "gt",
  timePeriod: 60,
  seriesName: "0/trace_id/cardinality",
} as const;
const report = {
  source: { kind: "traceQuery" },
  schedule: { cron: "0 9 * * 1", timezone: "UTC" },
  compareToPrevious: false,
} as const;

describe("Feature: rule-carrying automations survive redacted round trips", () => {
  describe("when a graph alert is written back", () => {
    /** @scenario "Writing back a graph alert keeps the rule it fires by" */
    it("keeps the rule a graph alert fires by", async () => {
      const alert = triggerRow({
        id: "trigger_alert",
        action: TriggerAction.SEND_EMAIL,
        triggerKind: "ALERT",
        customGraphId: "graph_1",
        alertType: "WARNING",
        actionParams: { members: ["a@example.com"], ...rule },
      });
      const rig = createPublicApiRig({ rows: [alert] });
      const read = await readTrigger(await rig.api.get("/api/triggers/trigger_alert"));

      expect(read.actionParams).toEqual({ members: ["a@example.com"] });
      expect(read.graphAlert).toEqual(rule);

      const response = await rig.api.patch("/api/triggers/trigger_alert", {
        actionParams: read.actionParams,
      });
      expect(response.status).toBe(200);
      expect(rig.rows.get("trigger_alert")?.actionParams).toMatchObject(rule);
    });
  });

  describe("when a scheduled report is written back", () => {
    /** @scenario "Writing back a scheduled report keeps its schedule" */
    it("keeps the schedule a report sends on", async () => {
      const row = triggerRow({
        id: "trigger_report",
        action: TriggerAction.SEND_EMAIL,
        triggerKind: "REPORT",
        actionParams: { members: ["a@example.com"], ...report },
      });
      const rig = createPublicApiRig({ rows: [row] });
      const read = await readTrigger(await rig.api.get("/api/triggers/trigger_report"));

      await rig.api.patch("/api/triggers/trigger_report", { actionParams: read.actionParams });
      expect(rig.rows.get("trigger_report")?.actionParams).toMatchObject({
        schedule: report.schedule,
      });
      expect(rig.syncReportSchedule).toHaveBeenCalledWith(
        expect.objectContaining({ cron: "0 9 * * 1" }),
      );
    });
  });

  describe("when an automation is deleted", () => {
    /** @scenario "Deleting a trigger reports the deletion" */
    it("names the automation and reports it deleted", async () => {
      const rig = createPublicApiRig({
        rows: [triggerRow({ id: "trigger_1", action: TriggerAction.SEND_EMAIL })],
      });
      const response = await rig.api.delete("/api/triggers/trigger_1");

      expect(await response.json()).toEqual({ id: "trigger_1", deleted: true });
      expect(rig.rows.get("trigger_1")?.deleted).toBe(true);
    });
  });
});
