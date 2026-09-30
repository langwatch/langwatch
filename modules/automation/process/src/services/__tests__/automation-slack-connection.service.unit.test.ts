/** Automation's half of a Slack save. @see specs/automations/slack-connections.feature */
import { SlackIntegrationMissingError, type SlackConnectionView } from "@langwatch/slack-contract";
import { describe, expect, it } from "vitest";

import { AutomationSlackConnectionService } from "../automation-slack-connection.service.ts";

const PROJECT = "project-1";
const WEBHOOK_URL = ["https://hooks.slack.com", "services", "fake"].join("/");

function view(id: string, kind: SlackConnectionView["kind"]): SlackConnectionView {
  return {
    id,
    name: id,
    kind,
    scopeType: "PROJECT",
    scopeId: PROJECT,
    scopeName: "Project",
    secretHint: "…",
    slackTeamId: null,
    slackTeamName: null,
    dependentAutomations: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function serviceOver(connections: SlackConnectionView[]) {
  const calls: string[] = [];
  const slack = {
    getUsableSlackConnection: async ({ id }: { id: string; projectId: string }) => {
      const found = connections.find((connection) => connection.id === id);
      if (!found) throw new SlackIntegrationMissingError();
      return found;
    },
    findOrCreateSlackConnectionForSecret: async (input: {
      kind: SlackConnectionView["kind"];
      organizationId: string;
    }) => {
      calls.push(`findOrCreate:${input.organizationId}:${input.kind}`);
      connections.push(view("created", input.kind));
      return { id: "created", wasCreated: true };
    },
    claimConnection: async (input: {
      connectionId: string;
      claimant: { id: string; label: string };
    }) => {
      calls.push(`claim:${input.connectionId}:${input.claimant.id}:${input.claimant.label}`);
    },
    releaseConnection: async (input: { connectionId: string; claimantId: string }) => {
      calls.push(`release:${input.connectionId}:${input.claimantId}`);
    },
  };
  const service = AutomationSlackConnectionService.create({
    slack,
    projects: { getOrganizationId: async () => "org-1" },
    crypto: {
      encrypt: (value) => `enc(${value})`,
      decrypt: (value) => value.replace(/^enc\(|\)$/g, ""),
    },
  });
  return { service, calls };
}

const trigger = { id: "trigger-1", name: "Quality alert" };
const on = (connectionId: string, active = true) => ({
  actionParams: { slackIntegrationId: connectionId, slackDelivery: "webhook" },
  active,
});

describe("AutomationSlackConnectionService.connectActionParams", () => {
  describe("given a save naming a webhook connection", () => {
    it("keeps the connection and drops every secret", async () => {
      const { service } = serviceOver([view("conn-1", "INCOMING_WEBHOOK")]);

      const params = await service.connectActionParams({
        projectId: PROJECT,
        actorId: "user-1",
        actionParams: { slackIntegrationId: "conn-1", slackWebhook: WEBHOOK_URL, members: ["a"] },
      });

      expect(params).toEqual({
        slackIntegrationId: "conn-1",
        slackDelivery: "webhook",
        members: ["a"],
      });
    });
  });

  describe("given a save typing a legacy webhook URL", () => {
    it("stores it as a connection in the project's organization", async () => {
      const { service, calls } = serviceOver([]);

      const params = await service.connectActionParams({
        projectId: PROJECT,
        actorId: "user-1",
        actionParams: { slackDelivery: "webhook", slackWebhook: WEBHOOK_URL },
      });

      expect(params).toEqual({ slackIntegrationId: "created", slackDelivery: "webhook" });
      expect(calls).toEqual(["findOrCreate:org-1:INCOMING_WEBHOOK"]);
    });
  });

  describe("given a bot save without a channel", () => {
    it("refuses before storing any connection", async () => {
      const { service, calls } = serviceOver([]);

      await expect(
        service.connectActionParams({
          projectId: PROJECT,
          actorId: "user-1",
          actionParams: { slackDelivery: "bot", slackBotToken: "xoxb-typed" },
        }),
      ).rejects.toMatchObject({ code: "invalid_action_params" });
      expect(calls).toEqual([]);
    });
  });
});

describe("AutomationSlackConnectionService.withKeptLegacySlackSecret", () => {
  /** @scenario "Editing a bot automation without re-entering the token" */
  it("puts the row's stored bot token back, decrypted, when the save typed none", () => {
    const { service } = serviceOver([]);

    const params = service.withKeptLegacySlackSecret({
      actionParams: { slackDelivery: "bot", slackChannelId: "C1", slackBotToken: "__kept__" },
      stored: { slackDelivery: "bot", slackBotToken: "enc(xoxb-stored)" },
    });

    expect(params).toMatchObject({ slackBotToken: "xoxb-stored" });
  });
});

describe("AutomationSlackConnectionService.updateConnectionClaim", () => {
  /** @scenario "Saving an automation on a connection claims it" */
  it("claims the connection a new automation is saved on", async () => {
    const { service, calls } = serviceOver([]);

    await service.updateConnectionClaim({
      projectId: PROJECT,
      trigger,
      before: undefined,
      after: on("conn-1"),
    });

    expect(calls).toEqual(["claim:conn-1:trigger-1:Quality alert"]);
  });

  /** @scenario "Moving an automation to another connection releases the first" */
  it("releases the first connection and claims the second", async () => {
    const { service, calls } = serviceOver([]);

    await service.updateConnectionClaim({
      projectId: PROJECT,
      trigger,
      before: on("conn-1"),
      after: on("conn-2"),
    });

    expect(calls).toEqual(["release:conn-1:trigger-1", "claim:conn-2:trigger-1:Quality alert"]);
  });

  /** @scenario "Pausing or deleting an automation releases its connection" */
  it("releases on pause and on delete, and claims again on reactivation", async () => {
    const { service, calls } = serviceOver([]);

    await service.updateConnectionClaim({
      projectId: PROJECT,
      trigger,
      before: on("conn-1"),
      after: on("conn-1", false),
    });
    await service.updateConnectionClaim({
      projectId: PROJECT,
      trigger,
      before: on("conn-1"),
      after: undefined,
    });
    await service.updateConnectionClaim({
      projectId: PROJECT,
      trigger,
      before: on("conn-1", false),
      after: on("conn-1"),
    });

    expect(calls).toEqual([
      "release:conn-1:trigger-1",
      "release:conn-1:trigger-1",
      "claim:conn-1:trigger-1:Quality alert",
    ]);
  });
});
