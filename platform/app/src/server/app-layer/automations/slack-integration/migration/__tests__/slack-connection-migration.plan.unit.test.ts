import { describe, expect, it } from "vitest";
import {
  SlackIntegrationKind,
  SlackIntegrationScopeType,
} from "~/generated/prisma/client";
import {
  type MigrationAutomation,
  type MigrationConnection,
  planSlackConnectionMigration,
} from "../slack-connection-migration.plan";
import {
  dryRunOutcome,
  formatOrganizationOutcome,
  formatTally,
  tallyOutcomes,
} from "../slack-connection-migration.report";

const ORG = "org-1";
const TOKEN = "xoxb-shared-token-9f3a";
const WEBHOOK = "https://hooks.slack.com/services/T0/B0/secretpath7c21";

/** Ciphertext is `enc<n>:<plaintext>`, so one secret can have many encodings, as a random IV gives. */
const decryptSecret = ({ ciphertext }: { ciphertext: string }) => {
  const [prefix, ...rest] = ciphertext.split(":");
  if (!prefix?.startsWith("enc")) throw new Error("undecryptable");
  return rest.join(":");
};
const fingerprintSecret = ({ secret }: { secret: string }) => `fp:${secret}`;

let sequence = 0;
function botAutomation({
  projectId,
  token,
}: {
  projectId: string;
  token?: string;
}): MigrationAutomation {
  sequence += 1;
  return {
    id: `bot-${sequence}`,
    projectId,
    name: `Bot automation ${sequence}`,
    actionParams: {
      slackDelivery: "bot",
      slackChannelId: "C0123",
      ...(token ? { slackBotToken: `enc${sequence}:${token}` } : {}),
    },
  };
}

function webhookAutomation({
  projectId,
  url = WEBHOOK,
  delivery = "webhook",
}: {
  projectId: string;
  url?: string;
  delivery?: "webhook" | "absent";
}): MigrationAutomation {
  sequence += 1;
  return {
    id: `hook-${sequence}`,
    projectId,
    name: `Webhook automation ${sequence}`,
    actionParams: {
      ...(delivery === "webhook" ? { slackDelivery: "webhook" } : {}),
      slackWebhook: url,
    },
  };
}

function projectBotConnection({
  projectId,
  token = TOKEN,
  id = "conn-existing",
}: {
  projectId: string;
  token?: string;
  id?: string;
}): MigrationConnection {
  return {
    id,
    name: "Acme workspace",
    kind: SlackIntegrationKind.BOT,
    scopeType: SlackIntegrationScopeType.PROJECT,
    scopeId: projectId,
    secretFingerprint: fingerprintSecret({ secret: token }),
  };
}

function plan({
  automations,
  connections = [],
  archivedProjectIds = [],
}: {
  automations: MigrationAutomation[];
  connections?: MigrationConnection[];
  archivedProjectIds?: string[];
}) {
  return planSlackConnectionMigration({
    organizationId: ORG,
    automations,
    archivedProjectIds,
    connections,
    decryptSecret,
    fingerprintSecret,
  });
}

const memberIds = (connection: { members: MigrationAutomation[] }) =>
  connection.members.map((member) => member.id);

describe("planSlackConnectionMigration", () => {
  describe("given automations in one project sharing secrets", () => {
    /** @scenario Automations sharing a secret share one connection */
    it("plans one project connection per secret, each holding its automations", () => {
      const bots = [1, 2, 3].map(() =>
        botAutomation({ projectId: "p1", token: TOKEN }),
      );
      const hooks = [1, 2].map(() => webhookAutomation({ projectId: "p1" }));

      const result = plan({ automations: [...bots, ...hooks] });

      expect(result.skipped).toEqual([]);
      expect(result.connections).toHaveLength(2);
      const [bot, hook] = result.connections;
      expect(bot).toMatchObject({
        action: "create",
        kind: SlackIntegrationKind.BOT,
        scopeType: SlackIntegrationScopeType.PROJECT,
        scopeId: "p1",
        secret: TOKEN,
        secretFingerprint: `fp:${TOKEN}`,
        secretHint: "9f3a",
        name: "Slack bot ••••9f3a",
      });
      expect(bot && memberIds(bot)).toEqual(bots.map((b) => b.id));
      expect(hook).toMatchObject({
        action: "create",
        kind: SlackIntegrationKind.INCOMING_WEBHOOK,
        scopeType: SlackIntegrationScopeType.PROJECT,
        scopeId: "p1",
        name: "Slack webhook ••••7c21",
      });
      expect(hook && memberIds(hook)).toEqual(hooks.map((h) => h.id));
    });

    it("reads a row saved before the delivery method existed as a webhook", () => {
      const legacy = webhookAutomation({ projectId: "p1", delivery: "absent" });

      const result = plan({ automations: [legacy] });

      expect(result.connections[0]).toMatchObject({
        kind: SlackIntegrationKind.INCOMING_WEBHOOK,
        members: [legacy],
      });
    });
  });

  describe("given one secret used in two projects", () => {
    /** @scenario A secret shared across projects becomes an organization connection */
    it("plans one organization connection holding both automations", () => {
      const first = webhookAutomation({ projectId: "p1" });
      const second = webhookAutomation({ projectId: "p2" });

      const result = plan({ automations: [first, second] });

      expect(result.connections).toHaveLength(1);
      expect(result.connections[0]).toMatchObject({
        action: "create",
        scopeType: SlackIntegrationScopeType.ORGANIZATION,
        scopeId: ORG,
        members: [first, second],
      });
    });
  });

  describe("given a secret also used in an archived project", () => {
    it("skips the archived project's automation and keeps the connection on the live project", () => {
      const live = webhookAutomation({ projectId: "p1" });
      const archived = webhookAutomation({ projectId: "p-archived" });

      const result = plan({
        automations: [live, archived],
        archivedProjectIds: ["p-archived"],
      });

      expect(result.connections).toHaveLength(1);
      expect(result.connections[0]).toMatchObject({
        action: "create",
        scopeType: SlackIntegrationScopeType.PROJECT,
        scopeId: "p1",
        members: [live],
      });
      expect(result.skipped).toEqual([
        { automation: archived, reason: "archived project" },
      ]);
    });

    it("never widens an existing project connection on its account", () => {
      const existing = projectBotConnection({ projectId: "p1" });
      const archived = botAutomation({ projectId: "p-archived", token: TOKEN });

      const result = plan({
        automations: [archived],
        connections: [existing],
        archivedProjectIds: ["p-archived"],
      });

      expect(result.connections).toEqual([]);
      expect(result.skipped).toEqual([
        { automation: archived, reason: "archived project" },
      ]);
    });
  });

  describe("given a project whose connection predates this change", () => {
    /** @scenario A project's existing connection absorbs matching automations */
    it("links the matching automation and the tokenless bot to it and creates nothing", () => {
      const existing = projectBotConnection({ projectId: "p1" });
      const withToken = botAutomation({ projectId: "p1", token: TOKEN });
      const tokenless = botAutomation({ projectId: "p1" });

      const result = plan({
        automations: [withToken, tokenless],
        connections: [existing],
      });

      expect(result.skipped).toEqual([]);
      expect(result.connections).toEqual([
        {
          action: "reuse",
          connectionId: existing.id,
          name: existing.name,
          kind: SlackIntegrationKind.BOT,
          scopeType: SlackIntegrationScopeType.PROJECT,
          scopeId: "p1",
          members: [withToken, tokenless],
        },
      ]);
    });

    it("widens it to the organization when another project's automation shares its token", () => {
      const existing = projectBotConnection({ projectId: "p1" });
      const elsewhere = botAutomation({ projectId: "p2", token: TOKEN });

      const result = plan({
        automations: [elsewhere],
        connections: [existing],
      });

      expect(result.connections[0]).toMatchObject({
        action: "reuse",
        connectionId: existing.id,
        scopeType: SlackIntegrationScopeType.ORGANIZATION,
        scopeId: ORG,
        widenedFromProjectId: "p1",
      });
    });

    it("keeps an organization connection as it is", () => {
      const existing: MigrationConnection = {
        ...projectBotConnection({ projectId: "p1" }),
        scopeType: SlackIntegrationScopeType.ORGANIZATION,
        scopeId: ORG,
      };
      const member = botAutomation({ projectId: "p1", token: TOKEN });

      const [reused] = plan({
        automations: [member],
        connections: [existing],
      }).connections;

      expect(reused).toMatchObject({
        action: "reuse",
        scopeType: SlackIntegrationScopeType.ORGANIZATION,
        scopeId: ORG,
      });
      expect(reused).not.toHaveProperty("widenedFromProjectId");
    });

    it("skips a tokenless bot whose project has two bot connections to choose from", () => {
      const tokenless = botAutomation({ projectId: "p1" });

      const result = plan({
        automations: [tokenless],
        connections: [
          projectBotConnection({ projectId: "p1", id: "a" }),
          projectBotConnection({ projectId: "p1", id: "b", token: "xoxb-2" }),
        ],
      });

      expect(result.connections).toEqual([]);
      expect(result.skipped).toEqual([
        { automation: tokenless, reason: "ambiguous project connection" },
      ]);
    });
  });

  describe("given automations that already point at a connection", () => {
    /** @scenario The migration changes nothing unless applied, and nothing twice */
    it("plans nothing for them, so a second run creates and links nothing", () => {
      const linked: MigrationAutomation = {
        id: "done",
        projectId: "p1",
        name: "Already migrated",
        actionParams: {
          slackDelivery: "bot",
          slackBotToken: `enc1:${TOKEN}`,
          slackIntegrationId: "conn-1",
        },
      };

      const result = plan({ automations: [linked] });

      expect(result).toEqual({
        organizationId: ORG,
        connections: [],
        skipped: [],
      });
    });

    /** @scenario The migration changes nothing unless applied, and nothing twice */
    it("reports what a dry run would create and link without naming any secret", () => {
      const bot = botAutomation({ projectId: "p1", token: TOKEN });
      const hook = webhookAutomation({ projectId: "p1" });
      const outcome = dryRunOutcome({
        plan: plan({ automations: [bot, hook] }),
      });

      const lines = formatOrganizationOutcome({
        outcome,
        organizationName: "Acme",
      });

      expect(lines).toEqual([
        `Organization "Acme" (${ORG})`,
        '  create  "Slack bot ••••9f3a"  bot  project p1  1 automation',
        `    link  ${bot.id} "${bot.name}" (project p1)`,
        '  create  "Slack webhook ••••7c21"  webhook  project p1  1 automation',
        `    link  ${hook.id} "${hook.name}" (project p1)`,
      ]);
      expect(lines.join("\n")).not.toContain(TOKEN);
      expect(lines.join("\n")).not.toContain(WEBHOOK);
      expect(
        formatTally({ tally: tallyOutcomes({ outcomes: [outcome] }) }),
      ).toBe(
        "Connections created 2, reused 0, widened 0; automations linked 2, skipped 0",
      );
    });
  });

  describe("given a token that cannot be decrypted", () => {
    /** @scenario A secret that cannot be decrypted is skipped, not guessed */
    it("skips the automation and plans no connection for it", () => {
      const broken: MigrationAutomation = {
        id: "broken",
        projectId: "p1",
        name: "Broken",
        actionParams: { slackDelivery: "bot", slackBotToken: "garbage" },
      };
      const fine = webhookAutomation({ projectId: "p1" });

      const result = plan({
        automations: [broken, fine],
        connections: [projectBotConnection({ projectId: "p1" })],
      });

      expect(result.skipped).toEqual([
        { automation: broken, reason: "cannot decrypt" },
      ]);
      expect(result.connections.flatMap(memberIds)).toEqual([fine.id]);
      expect(
        formatTally({
          tally: tallyOutcomes({ outcomes: [dryRunOutcome({ plan: result })] }),
        }),
      ).toBe(
        "Connections created 1, reused 0, widened 0; automations linked 1, skipped 1 (cannot decrypt: 1)",
      );
    });
  });

  describe("given an automation with nothing to post with", () => {
    it("skips a webhook without a URL and a tokenless bot without a project connection", () => {
      const noUrl: MigrationAutomation = {
        id: "no-url",
        projectId: "p1",
        name: "No URL",
        actionParams: { slackDelivery: "webhook", slackWebhook: "  " },
      };
      const tokenless = botAutomation({ projectId: "p2" });

      const result = plan({
        automations: [noUrl, tokenless],
        connections: [projectBotConnection({ projectId: "p1" })],
      });

      expect(result.connections).toEqual([]);
      expect(result.skipped).toEqual([
        { automation: noUrl, reason: "no secret" },
        { automation: tokenless, reason: "no secret" },
      ]);
    });

    it("skips settings it cannot read", () => {
      const unreadable: MigrationAutomation = {
        id: "odd",
        projectId: "p1",
        name: "Odd",
        actionParams: { slackDelivery: "carrier-pigeon" },
      };

      expect(plan({ automations: [unreadable] }).skipped).toEqual([
        { automation: unreadable, reason: "unreadable settings" },
      ]);
    });
  });
});
