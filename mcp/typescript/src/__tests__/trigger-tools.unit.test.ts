import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../langwatch-api.js", () => ({ makeRequest: vi.fn() }));

import { makeRequest } from "../langwatch-api.ts";
import {
  createTrigger,
  getTrigger,
  listTriggerFires,
  testFireTrigger,
  updateTrigger,
} from "../langwatch-api-triggers.ts";
import {
  actionParamsSchema,
  reportSchema,
  SLACK_DELIVERY_NOTE,
  TRIGGER_FILTER_QUERY_DESCRIPTION,
  TRIGGER_FILTERS_DESCRIPTION,
  validateActionParamsForAction,
} from "../schemas/triggers.ts";
import { handleCreateTrigger } from "../tools/create-trigger.ts";
import { handleListTriggerFires } from "../tools/list-trigger-fires.ts";
import { handleListTriggers } from "../tools/list-triggers.ts";

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
        "/api/v1/triggers",
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
        "/api/v1/triggers",
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
        "/api/v1/triggers/trigger-1",
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

    it("refuses bot delivery with a channel but no connection or token", () => {
      const result = validateActionParamsForAction({
        action: "SEND_SLACK_MESSAGE",
        actionParams: { slackDelivery: "bot", slackChannelId: "C123" },
      });
      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.message).toContain("slackIntegrationId");
    });

    it("refuses a bot connection with no channel", () => {
      expect(
        validateActionParamsForAction({
          action: "SEND_SLACK_MESSAGE",
          actionParams: { slackIntegrationId: "slack_1", slackDelivery: "bot" },
        }).ok,
      ).toBe(false);
    });

    it("accepts a Slack connection by id, with a channel for a bot", () => {
      expect(
        validateActionParamsForAction({
          action: "SEND_SLACK_MESSAGE",
          actionParams: { slackIntegrationId: "slack_1" },
        }).ok,
      ).toBe(true);
      expect(
        validateActionParamsForAction({
          action: "SEND_SLACK_MESSAGE",
          actionParams: { slackIntegrationId: "slack_1", slackChannelId: "C123" },
        }).ok,
      ).toBe(true);
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
          actionParams: {
            slackDelivery: "bot",
            slackBotToken: "xoxb-legacy",
            slackChannelId: "C123",
          },
        }).ok,
      ).toBe(true);
      expect(
        validateActionParamsForAction({
          action: "SEND_SLACK_MESSAGE",
          actionParams: {
            slackDelivery: "bot",
            slackBotTokenSet: true,
            slackChannelId: "C123",
          },
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
        "/api/v1/triggers/trigger-1",
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
        "/api/v1/triggers/trigger-1/test-fire",
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
        (await listTriggerFires({ id: "trigger-1", limit: 5 })).fires,
      ).toHaveLength(1);
      expect(request).toHaveBeenCalledWith(
        "GET",
        "/api/v1/triggers/trigger-1/fires?limit=5",
      );
    });
  });

  describe("when an automation is created without a delivery configuration", () => {
    it("sends the empty configuration older callers relied on", async () => {
      request.mockResolvedValue(TRIGGER);

      const { content, isError } = await handleCreateTrigger({
        name: "Errors to Slack",
        action: "SEND_SLACK_MESSAGE",
        filters: '{"traces.error":["true"]}',
      });

      expect(content[0]?.text).toContain("created");
      expect(isError).toBeUndefined();
      expect(request).toHaveBeenCalledWith(
        "POST",
        "/api/v1/triggers",
        expect.objectContaining({
          actionParams: {},
          filters: { "traces.error": ["true"] },
        }),
      );
    });

    it("sends a Slack connection and channel as given", async () => {
      request.mockResolvedValue(TRIGGER);

      await handleCreateTrigger({
        name: "Errors to Slack",
        action: "SEND_SLACK_MESSAGE",
        actionParams: { slackIntegrationId: "slack_1", slackChannelId: "C123" },
      });

      expect(request).toHaveBeenCalledWith(
        "POST",
        "/api/v1/triggers",
        expect.objectContaining({
          actionParams: { slackIntegrationId: "slack_1", slackChannelId: "C123" },
        }),
      );
    });

    it("refuses a stated Slack configuration with nowhere to post", async () => {
      const { content, isError } = await handleCreateTrigger({
        name: "Errors to Slack",
        action: "SEND_SLACK_MESSAGE",
        actionParams: { slackDelivery: "bot" },
      });

      expect(content[0]?.text).toMatch(/^Error:/);
      expect(isError).toBe(true);
      expect(request).not.toHaveBeenCalled();
    });

    it("refuses filters that are not a JSON object", async () => {
      const { content, isError } = await handleCreateTrigger({
        name: "Bad",
        action: "SEND_EMAIL",
        filters: '["traces.error"]',
      });

      expect(content[0]?.text).toBe("Error: filters must be a JSON object");
      expect(isError).toBe(true);
      expect(request).not.toHaveBeenCalled();
    });
  });

  describe("when an alert or a report is created", () => {
    it("sends the graph and its rule for an alert", async () => {
      request.mockResolvedValue({ ...TRIGGER, kind: "ALERT" });

      const { content } = await handleCreateTrigger({
        name: "Latency",
        action: "SEND_EMAIL",
        actionParams: { members: ["team@example.com"] },
        customGraphId: "graph_1",
        graphAlert: {
          seriesName: "p95",
          operator: "gt",
          threshold: 2000,
          timePeriod: 5,
        },
        alertType: "WARNING",
      });

      expect(content[0]?.text).toContain("Kind: ALERT");
      expect(request).toHaveBeenCalledWith(
        "POST",
        "/api/v1/triggers",
        expect.objectContaining({
          customGraphId: "graph_1",
          graphAlert: expect.objectContaining({ threshold: 2000 }),
        }),
      );
    });
  });

  describe("when the tool descriptions explain conditions", () => {
    it("spells out the keyed shape, keyed by the monitor id", () => {
      expect(TRIGGER_FILTERS_DESCRIPTION).toContain(
        '{"evaluations.passed":{"<monitorId>":["false"]}}',
      );
      expect(TRIGGER_FILTERS_DESCRIPTION).toContain(
        '{"metadata.value":{"<key>":["true"]}}',
      );
      expect(TRIGGER_FILTERS_DESCRIPTION).toContain('{"traces.error":["true"]}');
      expect(TRIGGER_FILTERS_DESCRIPTION).toContain("not its evaluatorId");
      expect(TRIGGER_FILTER_QUERY_DESCRIPTION).toContain("evaluatorVerdict:fail");
    });

    it("says a Slack automation needs a connection, and where to find one", () => {
      expect(SLACK_DELIVERY_NOTE).toContain('"slackIntegrationId"');
      expect(SLACK_DELIVERY_NOTE).toContain("slackChannelId");
      expect(SLACK_DELIVERY_NOTE).toContain("Settings, Integrations, Slack");
      expect(SLACK_DELIVERY_NOTE).toContain("preferred");
      expect(SLACK_DELIVERY_NOTE).toContain("slackWebhook");
      expect(SLACK_DELIVERY_NOTE).toContain("never post");
    });
  });

  describe("when automations are listed as a digest", () => {
    it("states each one's kind, query and rule", async () => {
      request.mockResolvedValue([
        { ...TRIGGER, filterQuery: "status:error" },
        {
          ...TRIGGER,
          id: "trigger-2",
          kind: "ALERT",
          customGraphId: "graph_1",
          graphAlert: {
            seriesName: "p95",
            operator: "gt",
            threshold: 2000,
            timePeriod: 5,
          },
        },
      ]);

      const text = await handleListTriggers({});

      expect(text).toContain("**Kind**: AUTOMATION");
      expect(text).toContain("**Filter query**: status:error");
      expect(text).toContain("**Kind**: ALERT");
      expect(text).toContain("p95 gt 2000 over 5m on graph graph_1");
    });
  });

  describe("when fires are read a page at a time", () => {
    it("passes the cursor through and answers with the next one", async () => {
      request.mockResolvedValue({
        fires: [
          {
            id: "fire-2",
            triggerId: "trigger-1",
            customGraphId: null,
            firedAt: "2026-08-12T00:00:00.000Z",
            resolvedAt: null,
          },
        ],
        nextCursor: "cursor-3",
      });

      const text = await handleListTriggerFires({
        id: "trigger-1",
        limit: 1,
        cursor: "cursor-2",
      });

      expect(request).toHaveBeenCalledWith(
        "GET",
        "/api/v1/triggers/trigger-1/fires?limit=1&cursor=cursor-2",
      );
      expect(JSON.parse(text)).toMatchObject({ nextCursor: "cursor-3" });
    });

    it("reads an older deployment's bare list as the last page", async () => {
      request.mockResolvedValue([]);

      expect(await listTriggerFires({ id: "trigger-1" })).toEqual({
        fires: [],
        nextCursor: null,
      });
    });
  });
});
