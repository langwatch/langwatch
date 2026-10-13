import {
  automationApiUpsertInputSchema,
  type AutomationApiUpsertInput,
} from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import { automationRowFor } from "../automation-row.rules.ts";

const templates = { slackTemplate: "hello {{name}}" };

function draft(overrides: Record<string, unknown>): AutomationApiUpsertInput {
  return automationApiUpsertInputSchema.parse({
    projectId: "project-1",
    triggerId: "trigger-1",
    name: "My automation",
    action: "SEND_EMAIL",
    filters: {},
    actionParams: { members: ["a@example.com"] },
    templates,
    ...overrides,
  });
}

describe("automationRowFor", () => {
  describe("given a trace automation with a subject query", () => {
    it("clears the structured filters and keeps the query and alert type", () => {
      const input = draft({ alertType: "WARNING", filters: { "traces.origin": ["x"] } });
      expect(
        automationRowFor({
          input,
          actionParams: { members: ["a@example.com"] },
          filterQuery: "status:error",
          isGraphAlert: false,
          isReport: false,
          id: "trigger-1",
        }),
      ).toEqual({
        name: "My automation",
        action: "SEND_EMAIL",
        triggerKind: "AUTOMATION",
        alertType: "WARNING",
        filters: {},
        filterQuery: "status:error",
        customGraphId: null,
        actionParams: { members: ["a@example.com"] },
        slackTemplateType: null,
        slackTemplate: "hello {{name}}",
        emailSubjectTemplate: null,
        emailBodyTemplate: null,
      });
    });
  });

  describe("given a graph alert", () => {
    it("merges the threshold into the params and never carries a query", () => {
      const graphAlert = { threshold: 5, operator: "gt", timePeriod: 15, seriesName: "p95" };
      const input = draft({ customGraphId: "graph-1", alertType: "CRITICAL", graphAlert });
      expect(
        automationRowFor({
          input,
          actionParams: { members: ["a@example.com"] },
          filterQuery: "ignored",
          isGraphAlert: true,
          isReport: false,
          id: "trigger-1",
        }),
      ).toMatchInlineSnapshot(`
        {
          "action": "SEND_EMAIL",
          "actionParams": {
            "members": [
              "a@example.com",
            ],
            "operator": "gt",
            "seriesName": "p95",
            "threshold": 5,
            "timePeriod": 15,
          },
          "alertType": "CRITICAL",
          "customGraphId": "graph-1",
          "emailBodyTemplate": null,
          "emailSubjectTemplate": null,
          "filterQuery": null,
          "filters": {},
          "name": "My automation",
          "slackTemplate": "hello {{name}}",
          "slackTemplateType": null,
          "triggerKind": "ALERT",
        }
      `);
    });
  });

  describe("given a trace-query report", () => {
    it("releases any graph and keeps the query the report sends", () => {
      const report = {
        source: { kind: "traceQuery" },
        schedule: { cron: "0 9 * * *", timezone: "UTC" },
        compareToPrevious: false,
      };
      const input = draft({ customGraphId: null, report });
      expect(
        automationRowFor({
          input,
          actionParams: { members: ["a@example.com"] },
          filterQuery: "status:error",
          isGraphAlert: false,
          isReport: true,
          id: "trigger-1",
        }),
      ).toMatchInlineSnapshot(`
        {
          "action": "SEND_EMAIL",
          "actionParams": {
            "compareToPrevious": false,
            "members": [
              "a@example.com",
            ],
            "schedule": {
              "cron": "0 9 * * *",
              "timezone": "UTC",
            },
            "source": {
              "filters": {},
              "kind": "traceQuery",
              "topN": 5,
            },
          },
          "customGraphId": null,
          "emailBodyTemplate": null,
          "emailSubjectTemplate": null,
          "filterQuery": "status:error",
          "filters": {},
          "name": "My automation",
          "slackTemplate": "hello {{name}}",
          "slackTemplateType": null,
          "triggerKind": "REPORT",
        }
      `);
    });
  });
});
