/**
 * The alert a graph card renders, and what never leaves with it. The
 * application asks Automation for the trigger and strips the provider secrets
 * its parameters carry before any door sees the row.
 */
import type { Trigger } from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import { createDashboardTestApp, createDashboardTestAutomation } from "./dashboard.fixture.ts";

const WEBHOOK_URL = "https://hooks.slack.example/services/T000/B000/TheRealWebhookToken";

const trigger = {
  id: "trigger-1",
  active: true,
  deleted: false,
  alertType: "CRITICAL",
  action: "SEND_SLACK_MESSAGE",
  customGraphId: "graph-1",
  actionParams: {
    threshold: 10,
    operator: "gt",
    timePeriod: 60,
    seriesName: "Errors",
    members: ["someone@example.com"],
    slackWebhook: WEBHOOK_URL,
  },
} as unknown as Trigger;

function appWithAlert() {
  return createDashboardTestApp({
    dependencies: { automation: createDashboardTestAutomation([trigger]) },
  });
}

describe("the alert watching a graph", () => {
  describe("given a graph whose alert posts to a Slack incoming webhook", () => {
    describe("when the alert is read for one graph", () => {
      /** @scenario "A graph read returns no Slack webhook URL" */
      it("returns no webhook URL", async () => {
        const alert = await appWithAlert().findAlertForGraph({
          projectId: "project-1",
          customGraphId: "graph-1",
        });

        expect(JSON.stringify(alert)).not.toContain("TheRealWebhookToken");
        expect(JSON.stringify(alert)).not.toContain("slackWebhook");
      });

      /** @scenario "A graph read returns no Slack webhook URL" */
      it("still reports what the alert card renders", async () => {
        const alert = await appWithAlert().findAlertForGraph({
          projectId: "project-1",
          customGraphId: "graph-1",
        });

        expect(alert?.actionParams).toMatchObject({
          threshold: 10,
          operator: "gt",
          timePeriod: 60,
          seriesName: "Errors",
          members: ["someone@example.com"],
        });
        expect(alert?.id).toBe("trigger-1");
      });
    });

    describe("when the alert has been switched off", () => {
      it("reads as no alert at all", async () => {
        const app = createDashboardTestApp({
          dependencies: {
            automation: createDashboardTestAutomation([{ ...trigger, active: false } as Trigger]),
          },
        });

        await expect(
          app.findAlertForGraph({ projectId: "project-1", customGraphId: "graph-1" }),
        ).resolves.toBeUndefined();
      });
    });

    describe("when the alert has been deleted", () => {
      it("reads as no alert at all", async () => {
        const app = createDashboardTestApp({
          dependencies: {
            automation: createDashboardTestAutomation([{ ...trigger, deleted: true } as Trigger]),
          },
        });

        await expect(
          app.findAlertForGraph({ projectId: "project-1", customGraphId: "graph-1" }),
        ).resolves.toBeUndefined();
      });
    });

    describe("when the alerts are read for a list of graphs", () => {
      /** @scenario "A graph read returns no Slack webhook URL" */
      it("strips the same secret from every row", async () => {
        const alerts = await appWithAlert().getAlertsForGraphs({
          projectId: "project-1",
          customGraphIds: ["graph-1"],
        });

        expect(JSON.stringify(alerts)).not.toContain("TheRealWebhookToken");
      });
    });
  });
});
