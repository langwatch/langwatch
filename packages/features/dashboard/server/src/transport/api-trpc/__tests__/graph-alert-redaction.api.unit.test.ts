/**
 * @vitest-environment node
 *
 * What a graph read may say about the alert watching it.
 *
 * `getAll` routes an alert's parameters through the redaction port; `getById`
 * hand-picked fields off the raw trigger and returned the Slack incoming-
 * webhook URL — a bearer credential letting the holder post as LangWatch in
 * the customer's Slack.
 *
 * Covers @unit scenarios from
 * specs/security/feature-surface-secret-disclosure.feature.
 */
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { DashboardApp } from "../../../app/dashboard.app";
import { GraphTrpcApi } from "../graph.api";

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
};

function harness() {
  const trpc = initTRPC.context<{ app: { dashboard: DashboardApp } }>().create();
  const app = {
    getGraph: async () => ({ id: "graph-1", name: "Errors", filters: {} }),
    listGraphs: async () => [{ id: "graph-1", name: "Errors", filters: {} }],
    getAlertsForGraphs: async () => [trigger],
    tryGetAlertForGraph: async () => trigger,
  } as unknown as DashboardApp;

  const router = GraphTrpcApi.create(
    trpc,
    {
      protected: trpc.procedure,
      policy: () => (procedure) => procedure,
    },
    {
      filterFieldSchema: z.string(),
      // The port the process composes: it drops the provider secrets an
      // action's parameters carry, per the trigger's own action.
      redactActionParams: (_action, actionParams) => {
        const { slackWebhook: _drop, ...rest } = actionParams;
        return rest;
      },
    },
  );

  return router.createCaller({ app: { dashboard: app } });
}

describe("graphs.getById", () => {
  describe("given a graph whose alert posts to a Slack incoming webhook", () => {
    describe("when the graph is read by id", () => {
      /** @scenario "A graph read returns no Slack webhook URL" */
      it("returns no webhook URL", async () => {
        const result = await harness().getById({ projectId: "project-1", id: "graph-1" });

        expect(JSON.stringify(result)).not.toContain("TheRealWebhookToken");
        expect(JSON.stringify(result)).not.toContain("slackWebhook");
      });

      /** @scenario "A graph read returns no Slack webhook URL" */
      it("still reports what the alert card renders", async () => {
        const result = await harness().getById({ projectId: "project-1", id: "graph-1" });

        expect(result.alert).toMatchObject({
          enabled: true,
          threshold: 10,
          operator: "gt",
          timePeriod: 60,
          seriesName: "Errors",
          triggerId: "trigger-1",
        });
        expect(result.alert?.actionParams.members).toEqual(["someone@example.com"]);
      });
    });
  });
});
