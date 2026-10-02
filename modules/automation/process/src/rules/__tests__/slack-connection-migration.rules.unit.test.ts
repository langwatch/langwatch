/** The pure Slack connection migration plan. @see specs/automations/slack-connections.feature */
import { describe, expect, it } from "vitest";

import { slackMigrationReport } from "../slack-connection-migration-report.rules.ts";
import {
  planSlackConnectionMigration,
  withoutLegacySlackSecret,
  type MigrationAutomation,
  type ProjectBotConnection,
} from "../slack-connection-migration.rules.ts";

// Built at runtime so no fixture reads as a real credential.
const WEBHOOK_A = ["https://hooks.slack.com", "services", "T", "B", "aaaa"].join("/");
const WEBHOOK_B = ["https://hooks.slack.com", "services", "T", "B", "bbbb"].join("/");
const BOT_TOKEN = ["xoxb", "fake", "wxyz"].join("-");

function automation(
  id: string,
  actionParams: unknown,
  projectId = "project-1",
): MigrationAutomation {
  return { id, projectId, name: `Automation ${id}`, actionParams };
}

function plan({
  automations,
  archivedProjectIds = [],
  projectBots = [],
}: {
  automations: MigrationAutomation[];
  archivedProjectIds?: string[];
  projectBots?: ProjectBotConnection[];
}) {
  return planSlackConnectionMigration({
    organizationId: "org-1",
    automations,
    archivedProjectIds,
    projectBots,
    decryptSecret: ({ ciphertext }) => {
      if (!ciphertext.startsWith("enc:")) throw new Error("not ours");
      return ciphertext.slice(4);
    },
  });
}

describe("planSlackConnectionMigration", () => {
  describe("given two automations in one project sharing a webhook", () => {
    /** @scenario "Automations sharing a secret share one connection" */
    it("stores the webhook once and links both automations to it", () => {
      const result = plan({
        automations: [
          automation("a1", { slackWebhook: WEBHOOK_A }),
          automation("a2", { slackWebhook: ` ${WEBHOOK_A} ` }),
        ],
      });

      expect(result.connections).toHaveLength(1);
      expect(result.connections[0]).toMatchObject({
        action: "store",
        kind: "INCOMING_WEBHOOK",
        projectId: "project-1",
        secretHint: "aaaa",
      });
      expect(result.connections[0]?.members.map((member) => member.id)).toEqual(["a1", "a2"]);
    });
  });

  describe("given the same webhook in two projects", () => {
    /** @scenario "A secret shared across projects becomes one connection per project" */
    it("stores a connection per project, never widening a scope", () => {
      const result = plan({
        automations: [
          automation("a1", { slackWebhook: WEBHOOK_A }, "project-1"),
          automation("a2", { slackWebhook: WEBHOOK_A }, "project-2"),
        ],
      });

      expect(result.connections.map((connection) => connection.projectId)).toEqual([
        "project-1",
        "project-2",
      ]);
    });
  });

  describe("given a bot automation with its own encrypted token", () => {
    it("decrypts the token and stores it as a bot connection", () => {
      const result = plan({
        automations: [
          automation("b1", {
            slackDelivery: "bot",
            slackBotToken: `enc:${BOT_TOKEN}`,
            slackChannelId: "C1",
          }),
        ],
      });

      expect(result.connections[0]).toMatchObject({
        action: "store",
        kind: "BOT",
        secret: BOT_TOKEN,
      });
    });

    /** @scenario "A secret that cannot be decrypted is skipped, not guessed" */
    it("skips a token it cannot decrypt", () => {
      const result = plan({
        automations: [automation("b1", { slackDelivery: "bot", slackBotToken: "garbage" })],
      });

      expect(result.skipped).toEqual([
        { automation: expect.objectContaining({ id: "b1" }), reason: "cannot decrypt" },
      ]);
    });
  });

  describe("given a tokenless bot automation", () => {
    it("joins its project's one bot connection", () => {
      const result = plan({
        automations: [automation("b1", { slackDelivery: "bot", slackChannelId: "C1" })],
        projectBots: [{ id: "conn-bot", name: "Workspace bot", projectId: "project-1" }],
      });

      expect(result.connections).toEqual([
        expect.objectContaining({
          action: "join",
          connectionId: "conn-bot",
          members: [expect.objectContaining({ id: "b1" })],
        }),
      ]);
    });

    it("skips when the project has two bot connections to choose from", () => {
      const result = plan({
        automations: [automation("b1", { slackDelivery: "bot" })],
        projectBots: [
          { id: "one", name: "One", projectId: "project-1" },
          { id: "two", name: "Two", projectId: "project-1" },
        ],
      });

      expect(result.skipped.map(({ reason }) => reason)).toEqual(["ambiguous project connection"]);
    });

    it("skips when the project has none", () => {
      const result = plan({ automations: [automation("b1", { slackDelivery: "bot" })] });

      expect(result.skipped.map(({ reason }) => reason)).toEqual(["no secret"]);
    });
  });

  describe("given an automation already on a connection", () => {
    it("clears the secret it still stores", () => {
      const result = plan({
        automations: [automation("c1", { slackIntegrationId: "conn-1", slackWebhook: WEBHOOK_A })],
      });

      expect(result.cleared.map((member) => member.id)).toEqual(["c1"]);
      expect(result.connections).toEqual([]);
    });

    it("leaves a clean one alone", () => {
      const result = plan({
        automations: [automation("c1", { slackIntegrationId: "conn-1", slackDelivery: "webhook" })],
      });

      expect(result).toMatchObject({ connections: [], cleared: [], skipped: [] });
    });
  });

  describe("given rows the plan cannot move", () => {
    it("skips an archived project's automations, unreadable settings and an empty webhook", () => {
      const result = plan({
        automations: [
          automation("x1", { slackWebhook: WEBHOOK_B }, "archived"),
          automation("x2", { slackWebhook: 42 }),
          automation("x3", { slackDelivery: "webhook" }),
        ],
        archivedProjectIds: ["archived"],
      });

      expect(result.skipped.map(({ reason }) => reason)).toEqual([
        "archived project",
        "unreadable settings",
        "no secret",
      ]);
    });

    it("skips an automation whose secret is stored under the other kind", () => {
      const result = plan({
        automations: [
          automation("k1", { slackWebhook: BOT_TOKEN }),
          automation("k2", { slackDelivery: "bot", slackBotToken: `enc:${BOT_TOKEN}` }),
        ],
      });

      expect(result.skipped.map(({ reason }) => reason)).toEqual(["kind conflict"]);
    });
  });
});

describe("slackMigrationReport", () => {
  /** @scenario "The migration report never prints a secret" */
  it("counts and hints, never the secret", () => {
    const planned = plan({ automations: [automation("a1", { slackWebhook: WEBHOOK_A })] });

    const report = slackMigrationReport({
      outcome: { plan: planned, linkedIds: ["a1"], clearedIds: [], skipped: [], claimed: 1 },
    });

    expect(report).toMatchObject({ linked: 1, cleared: 0, skipped: 0, claimed: 1 });
    expect(report.connections).toEqual([
      {
        name: expect.stringContaining("aaaa"),
        projectId: "project-1",
        secretHint: "aaaa",
        automations: 1,
      },
    ]);
    expect(JSON.stringify(report)).not.toContain(WEBHOOK_A);
  });
});

describe("withoutLegacySlackSecret", () => {
  it("points the params at the connection and drops every legacy secret field", () => {
    expect(
      withoutLegacySlackSecret({
        actionParams: {
          slackWebhook: WEBHOOK_A,
          slackBotToken: "x",
          slackBotTokenSet: true,
          threshold: 3,
        },
        connectionId: "conn-1",
      }),
    ).toEqual({ threshold: 3, slackIntegrationId: "conn-1" });
  });
});
