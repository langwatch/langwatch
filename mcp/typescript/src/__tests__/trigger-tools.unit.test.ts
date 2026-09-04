import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../langwatch-api.js", () => ({ makeRequest: vi.fn() }));

import { makeRequest } from "../langwatch-api.js";
import {
  createTrigger,
  getTrigger,
  listTriggerFires,
  setTriggerActive,
  testFireTrigger,
  updateTrigger,
} from "../langwatch-api-triggers.js";
import {
  actionParamsSchema,
  reportSchema,
  validateActionParamsForAction,
} from "../schemas/triggers.js";

const request = vi.mocked(makeRequest);

const TRIGGER = {
  id: "trigger-1",
  name: "Errors to Slack",
  action: "SEND_SLACK_MESSAGE",
  actionParams: { slackWebhook: "[redacted]" },
  filters: { "metadata.labels": ["prod"] },
  filterQuery: null,
  kind: "AUTOMATION",
  customGraphId: null,
  notificationCadence: "5min_digest",
  traceDebounceMs: 30000,
  templates: {},
  active: true,
  message: null,
  alertType: null,
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
  platformUrl: "https://app.langwatch.ai/p/automations",
};

beforeEach(() => {
  request.mockReset();
});

describe("Feature: an agent configures an automation over MCP", () => {
  describe("when a Slack automation is created", () => {
    it("sends the delivery configuration the channel reads", async () => {
      request.mockResolvedValue(TRIGGER);

      await createTrigger({
        name: "Errors to Slack",
        action: "SEND_SLACK_MESSAGE",
        actionParams: {
          slackDelivery: "webhook",
          slackWebhook: "https://hooks.slack.com/services/T/B/x",
        },
        filters: { "metadata.labels": ["prod"] },
      });

      expect(request).toHaveBeenCalledWith(
        "POST",
        "/api/triggers",
        expect.objectContaining({
          action: "SEND_SLACK_MESSAGE",
          actionParams: {
            slackDelivery: "webhook",
            slackWebhook: "https://hooks.slack.com/services/T/B/x",
          },
        }),
      );
    });
  });

  describe("when a scheduled report is created", () => {
    it("sends what it renders and when, alongside the channel", async () => {
      request.mockResolvedValue(TRIGGER);

      await createTrigger({
        name: "Monday digest",
        action: "SEND_EMAIL",
        actionParams: { members: ["team@example.com"] },
        report: {
          source: { kind: "dashboard", dashboardId: "dashboard_1" },
          schedule: { cron: "0 9 * * 1", timezone: "Europe/Amsterdam" },
          compareToPrevious: true,
        },
      });

      expect(request).toHaveBeenCalledWith(
        "POST",
        "/api/triggers",
        expect.objectContaining({
          report: {
            source: { kind: "dashboard", dashboardId: "dashboard_1" },
            schedule: { cron: "0 9 * * 1", timezone: "Europe/Amsterdam" },
            compareToPrevious: true,
          },
        }),
      );
    });

    it("reads a schedule against the published shape", () => {
      const report = {
        source: { kind: "traceQuery" as const, topN: 10 },
        schedule: { cron: "0 9 * * 1", timezone: "UTC" },
      };

      expect(reportSchema.parse(report)).toMatchObject(report);
      expect(
        reportSchema.safeParse({ schedule: report.schedule }).success,
      ).toBe(false);
    });
  });

  describe("when an existing report's schedule is changed", () => {
    it("states the report alongside the fields it is changing", async () => {
      request.mockResolvedValue(TRIGGER);

      await updateTrigger({
        id: "trigger-1",
        report: {
          source: { kind: "customGraph", customGraphId: "graph_1" },
          schedule: { cron: "0 8 * * *", timezone: "UTC" },
        },
      });

      expect(request).toHaveBeenCalledWith(
        "PATCH",
        "/api/triggers/trigger-1",
        expect.objectContaining({
          report: expect.objectContaining({
            schedule: { cron: "0 8 * * *", timezone: "UTC" },
          }),
        }),
      );
    });
  });

  describe("when a webhook destination is read against the delivery schema", () => {
    it("keeps every field rather than reading it as an empty Slack one", () => {
      const destination = {
        url: "https://example.com/hooks/langwatch",
        headers: { Authorization: "Bearer x" },
      };

      expect(actionParamsSchema.parse(destination)).toEqual(destination);
    });
  });

  describe("when actionParams is bound to the channel named in action", () => {
    it("refuses a webhook with no url, instead of letting the Slack shape absorb it", () => {
      const verdict = validateActionParamsForAction({
        action: "SEND_WEBHOOK",
        actionParams: {},
      });

      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.message).toContain("SEND_WEBHOOK");
    });

    it("refuses email fields sent for a webhook channel", () => {
      expect(
        validateActionParamsForAction({
          action: "SEND_WEBHOOK",
          actionParams: { members: ["someone@example.com"] },
        }).ok,
      ).toBe(false);
    });

    it("accepts each channel's own configuration", () => {
      expect(
        validateActionParamsForAction({
          action: "SEND_EMAIL",
          actionParams: { members: ["someone@example.com"] },
        }).ok,
      ).toBe(true);
      expect(
        validateActionParamsForAction({
          action: "SEND_WEBHOOK",
          actionParams: { url: "https://example.com/hooks/langwatch" },
        }).ok,
      ).toBe(true);
    });

    it("refuses a Slack destination with nothing to deliver to", () => {
      expect(
        validateActionParamsForAction({
          action: "SEND_SLACK_MESSAGE",
          actionParams: {},
        }).ok,
      ).toBe(false);
      expect(
        validateActionParamsForAction({
          action: "SEND_SLACK_MESSAGE",
          actionParams: { slackDelivery: "bot" },
        }).ok,
      ).toBe(false);
    });

    it("accepts a Slack destination once it names where to deliver", () => {
      expect(
        validateActionParamsForAction({
          action: "SEND_SLACK_MESSAGE",
          actionParams: {
            slackWebhook: "https://hooks.slack.com/services/T/B/X",
          },
        }).ok,
      ).toBe(true);
      expect(
        validateActionParamsForAction({
          action: "SEND_SLACK_MESSAGE",
          actionParams: { slackDelivery: "bot", slackChannelId: "C123" },
        }).ok,
      ).toBe(true);
    });

    it("stays tolerant of an action this build does not know", () => {
      expect(
        validateActionParamsForAction({
          action: "SEND_CARRIER_PIGEON",
          actionParams: { members: ["someone@example.com"] },
        }).ok,
      ).toBe(true);
    });
  });

  describe("when an automation is read", () => {
    it("carries the fields the API answered with", async () => {
      request.mockResolvedValue(TRIGGER);

      expect(await getTrigger("trigger-1")).toMatchObject({
        id: "trigger-1",
        kind: "AUTOMATION",
        notificationCadence: "5min_digest",
        platformUrl: "https://app.langwatch.ai/p/automations",
      });
    });

    it("still reads one from a deployment that answers with less", async () => {
      const { kind, filterQuery, platformUrl, ...older } = TRIGGER;
      request.mockResolvedValue(older);

      expect(await getTrigger("trigger-1")).toMatchObject({ id: "trigger-1" });
    });
  });

  describe("when an automation's delivery configuration is replaced", () => {
    it("states it in full, without naming the channel", async () => {
      request.mockResolvedValue(TRIGGER);

      await updateTrigger({
        id: "trigger-1",
        actionParams: { slackWebhook: "[redacted]", slackChannelId: "C123" },
      });

      expect(request).toHaveBeenCalledWith(
        "PATCH",
        "/api/triggers/trigger-1",
        expect.objectContaining({
          actionParams: { slackWebhook: "[redacted]", slackChannelId: "C123" },
        }),
      );
      expect(request.mock.calls[0]?.[2]).not.toHaveProperty("id");
    });
  });

  describe("when an automation is exercised or inspected", () => {
    it("test-fires it at its own destination", async () => {
      request.mockResolvedValue({
        channel: "slack",
        recipientCount: 1,
        usedDefault: true,
        missingVariables: [],
        errors: [],
      });

      expect(await testFireTrigger("trigger-1")).toMatchObject({
        channel: "slack",
      });
      expect(request).toHaveBeenCalledWith(
        "POST",
        "/api/triggers/trigger-1/test-fire",
      );
    });

    it("reads its fires newest first", async () => {
      request.mockResolvedValue([
        {
          id: "fire-1",
          triggerId: "trigger-1",
          customGraphId: null,
          firedAt: "2026-08-12T00:00:00.000Z",
          resolvedAt: null,
        },
      ]);

      expect(
        await listTriggerFires({ id: "trigger-1", limit: 5 }),
      ).toHaveLength(1);
      expect(request).toHaveBeenCalledWith(
        "GET",
        "/api/triggers/trigger-1/fires?limit=5",
      );
    });

    it("resumes and pauses it through the verb that says so", async () => {
      request.mockResolvedValue(TRIGGER);

      await setTriggerActive({ id: "trigger-1", active: false });
      expect(request).toHaveBeenCalledWith(
        "POST",
        "/api/triggers/trigger-1/disable",
      );

      await setTriggerActive({ id: "trigger-1", active: true });
      expect(request).toHaveBeenCalledWith(
        "POST",
        "/api/triggers/trigger-1/enable",
      );
    });
  });
});
