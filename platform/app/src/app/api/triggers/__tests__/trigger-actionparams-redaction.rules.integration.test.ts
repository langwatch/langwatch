/**
 * Delivery credentials are redacted at the REST boundary: the rule-carrying
 * automations and deletion. A graph alert and a scheduled report keep the rule
 * and schedule they run by through a redacted read-modify-write, and a delete
 * answers without leaking what it deleted.
 */
import { nanoid } from "nanoid";
import { describe, expect, it, vi } from "vitest";
import { TriggerAction } from "~/generated/prisma/client";
import { graphAlertActionParamsSchema } from "~/server/app-layer/automations/graph-alert.builder";
import { reportActionParamsSchema } from "~/server/app-layer/automations/report.builder";
import { prisma } from "~/server/db";
import {
  registerRedactionProject,
  SLACK_WEBHOOK,
} from "./trigger-redaction-fixture";

// The route invalidates the active-triggers cache after a successful write.
// That is the only thing it needs the app layer for, and booting the whole app
// to no-op one cache drop would buy nothing this suite asserts.
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ triggers: { invalidate: async () => {} } }),
}));

import { app } from "../[[...route]]/app";

describe("Feature: rule-carrying automations survive redacted round trips", () => {
  const ns = `triggers-redaction-rules-${nanoid(8)}`;
  const { projectId, headers, storeTrigger, makeWriteBack } =
    registerRedactionProject(ns);
  const writeBack = makeWriteBack((input, init) => app.request(input, init));

  describe("when a graph alert is written back", () => {
    /** @scenario "Writing back a graph alert keeps the rule it fires by" */
    it("keeps the rule a graph alert fires by", async () => {
      const rule = {
        threshold: 5,
        operator: "gt",
        timePeriod: 60,
        seriesName: "Errors",
      };
      const stored = await storeTrigger({
        name: `Graph alert ${ns}`,
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: {
          slackDelivery: "webhook",
          slackWebhook: SLACK_WEBHOOK,
          ...rule,
        },
      });

      const response = await writeBack(stored.id);

      expect(response.status).toBe(200);
      const saved = (
        await prisma.trigger.findUniqueOrThrow({
          where: { id: stored.id, projectId: projectId() },
        })
      ).actionParams;
      expect(saved).toMatchObject({ ...rule, slackWebhook: SLACK_WEBHOOK });
      // The evaluator reads the rule straight off the row, so what matters is
      // that it still parses as a complete one.
      expect(graphAlertActionParamsSchema.safeParse(saved).success).toBe(true);
    });
  });

  describe("when a scheduled report is written back", () => {
    /** @scenario "Writing back a scheduled report keeps its schedule" */
    it("keeps the schedule a report sends on", async () => {
      const report = {
        source: { kind: "dashboard", dashboardId: "dashboard_1" },
        schedule: { cron: "0 9 * * 1", timezone: "Europe/Amsterdam" },
        compareToPrevious: true,
      };
      const stored = await storeTrigger({
        name: `Report ${ns}`,
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: {
          slackDelivery: "webhook",
          slackWebhook: SLACK_WEBHOOK,
          ...report,
        },
      });

      const response = await writeBack(stored.id);

      expect(response.status).toBe(200);
      const saved = (
        await prisma.trigger.findUniqueOrThrow({
          where: { id: stored.id, projectId: projectId() },
        })
      ).actionParams;
      expect(saved).toMatchObject(report);
      // The dispatcher skips a report it cannot read a source and schedule
      // from, so what matters is that both still parse.
      expect(reportActionParamsSchema.safeParse(saved).success).toBe(true);
    });
  });

  describe("when an automation is deleted", () => {
    /** @scenario "Deleting a trigger reports the deletion" */
    it("names the automation and reports it deleted", async () => {
      const stored = await storeTrigger({
        name: `Deleted ${ns}`,
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: {
          slackDelivery: "webhook",
          slackWebhook: SLACK_WEBHOOK,
        },
      });

      const response = await app.request(`/api/triggers/${stored.id}`, {
        method: "DELETE",
        headers: headers(),
      });

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).not.toContain(SLACK_WEBHOOK);
      expect(JSON.parse(body)).toEqual({ id: stored.id, deleted: true });
    });
  });
});
