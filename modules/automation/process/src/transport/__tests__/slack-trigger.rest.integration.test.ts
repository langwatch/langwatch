/**
 * @vitest-environment node
 * `POST /api/trigger/slack`, the narrow ancestor of `/api/triggers`, over the
 * real REST runtime, refusing through the process's canonical boundary.
 * @see specs/automations/slack-trigger-rest-api.feature
 */
import { InvalidActionParamsError, type AutomationApi } from "@langwatch/automation-contract";
import { SlackIntegrationMissingError } from "@langwatch/slack-contract";
import { describe, expect, it } from "vitest";

import { slackAutomationRest } from "../slack-trigger.rest.ts";
import { mountSlackAutomationRest } from "./automation-rest.harness.ts";

type Created = Parameters<AutomationApi["create"]>[0];

function mount(create: (command: Created) => Promise<void> = async () => undefined) {
  const created: Created[] = [];

  return {
    created,
    ...mountSlackAutomationRest({
      create: (async (command: Created) => {
        created.push(command);
        await create(command);

        return command as never;
      }) as AutomationApi["create"],
    }),
  };
}

describe("the /api/trigger/slack declaration", () => {
  it("answers at the literal path its callers hold, behind the manage permission", () => {
    const declaration = slackAutomationRest.router();

    expect(declaration.addressing).toBe("literal");
    expect(
      declaration.routes.map((route) => `${route.method.toUpperCase()} ${route.path}`),
    ).toEqual(["POST /api/trigger/slack"]);
    expect(declaration.routes[0]?.permission).toBe("triggers:manage");
    expect(declaration.routes[0]?.operation).toBe("postApiTriggerSlack");
  });
});

describe("given the Slack alert door", () => {
  describe("when the body names a webhook, a condition and a severity", () => {
    /** @scenario "A valid body creates the trigger" */
    it("creates the Slack automation and answers its one sentence", async () => {
      const api = mount();

      const response = await api.post("/api/trigger/slack", {
        slack_webhook: "https://hooks.slack.com/services/abc",
        name: "Billing alerts",
        filters: { "topics.topics": ["billing"] },
        alert_type: "CRITICAL",
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        message: "Slack trigger created successfully",
      });
      expect(api.created).toEqual([
        {
          projectId: "project_1",
          actorId: "user_owner",
          action: "SEND_SLACK_MESSAGE",
          name: "Billing alerts",
          message: undefined,
          filters: { "topics.topics": ["billing"] },
          actionParams: { slackWebhook: "https://hooks.slack.com/services/abc" },
          alertType: "CRITICAL",
        },
      ]);
    });
  });

  describe("when the body fails the schema", () => {
    /** @scenario "A body missing its required fields is refused by name" */
    it("answers the handled validation refusal, never the 500 that told a caller to retry", async () => {
      const api = mount();

      const response = await api.post("/api/trigger/slack", {
        name: "No webhook",
        alert_type: "CRITICAL",
      });
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body).toMatchObject({ code: "validation_error" });
      expect(JSON.stringify(body)).toContain("slack_webhook");
      expect(api.created).toEqual([]);
    });

    it("refuses a filter on a field traces cannot be filtered by", async () => {
      const api = mount();

      const response = await api.post("/api/trigger/slack", {
        slack_webhook: "https://hooks.slack.com/services/abc",
        name: "Billing alerts",
        filters: { topics: ["billing"] },
        alert_type: "CRITICAL",
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "validation_error" });
      expect(api.created).toEqual([]);
    });
  });

  describe("when the caller uses the /api/v1 alias", () => {
    it("creates the trigger exactly as the bare path does", async () => {
      const api = mount();

      const response = await api.post("/api/v1/trigger/slack", {
        slack_webhook: "https://hooks.slack.com/services/abc",
        name: "Billing alerts",
        alert_type: "INFO",
      });

      expect(response.status).toBe(200);
      expect(api.created).toHaveLength(1);
    });
  });

  describe("when the body is not JSON", () => {
    /** @scenario "A body that is not JSON is refused" */
    it("refuses it with a 400 and creates nothing", async () => {
      const api = mount();

      const response = await api.postRaw("/api/trigger/slack", "{not json");

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "malformed_request" });
      expect(api.created).toEqual([]);
    });
  });

  describe("when the application refuses the create", () => {
    it("answers the generic unknown error, with the detail left in the log", async () => {
      const api = mount(async () => {
        throw new Error("connection reset");
      });

      const response = await api.post("/api/trigger/slack", {
        slack_webhook: "https://hooks.slack.com/services/abc",
        name: "Billing alerts",
        alert_type: "INFO",
      });

      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ code: "internal_error" });
    });
  });
});

describe("given the Slack alert door and a Slack connection", () => {
  const alert = { name: "Billing alerts", alert_type: "CRITICAL" };

  describe("when the body names a webhook connection", () => {
    /** @scenario "A Slack alert is created through a webhook connection" */
    it("creates the automation pointing at that connection, with no secret", async () => {
      const api = mount();

      const response = await api.post("/api/trigger/slack", {
        ...alert,
        slack_connection_id: "conn-hook",
      });

      expect(response.status).toBe(200);
      expect(api.created[0]?.actionParams).toEqual({ slackIntegrationId: "conn-hook" });
    });
  });

  describe("when the body names a bot connection and a channel", () => {
    /** @scenario "A Slack alert is created through a bot connection and a channel" */
    it("creates the automation pointing at that connection and channel", async () => {
      const api = mount();

      const response = await api.post("/api/trigger/slack", {
        ...alert,
        slack_connection_id: "conn-bot",
        slack_channel_id: "C123",
      });

      expect(response.status).toBe(200);
      expect(api.created[0]?.actionParams).toEqual({
        slackIntegrationId: "conn-bot",
        slackChannelId: "C123",
      });
    });
  });

  describe("when a bot connection is named without a channel", () => {
    /** @scenario "A Slack alert through a bot connection needs a channel" */
    it("answers the unusable-configuration refusal", async () => {
      const api = mount(async () => {
        throw new InvalidActionParamsError(
          "A Slack channel is required for a bot connection.",
          "slackChannelId",
        );
      });

      const response = await api.post("/api/trigger/slack", {
        ...alert,
        slack_connection_id: "conn-bot",
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "invalid_action_params" });
    });
  });

  describe("when the connection is not one the project can use", () => {
    /** @scenario "A Slack alert naming a connection the project cannot use is refused" */
    it("answers the integration-missing refusal", async () => {
      const api = mount(async () => {
        throw new SlackIntegrationMissingError();
      });

      const response = await api.post("/api/trigger/slack", {
        ...alert,
        slack_connection_id: "elsewhere",
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "slack_integration_missing" });
    });
  });

  describe("when the body names no destination, or two", () => {
    /** @scenario "A Slack alert naming no destination is refused" */
    it("refuses a body with neither", async () => {
      const api = mount();

      const response = await api.post("/api/trigger/slack", alert);

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "validation_error" });
      expect(api.created).toEqual([]);
    });

    /** @scenario "A Slack alert naming two destinations is refused" */
    it("refuses a body with both", async () => {
      const api = mount();

      const response = await api.post("/api/trigger/slack", {
        ...alert,
        slack_connection_id: "conn-hook",
        slack_webhook: "https://hooks.slack.com/services/abc",
      });

      expect(response.status).toBe(422);
      expect(api.created).toEqual([]);
    });
  });
});
