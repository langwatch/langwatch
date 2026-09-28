/**
 * The migration against real rows: one connection per secret, a JSON merge that
 * keeps legacy fields, a second run that writes nothing, and tenancy guards
 * that accept the queries and the raw link update the task issues.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type Organization,
  type Project,
  SlackIntegrationKind,
  SlackIntegrationScopeType,
  type Team,
  TriggerAction,
  TriggerKind,
} from "~/generated/prisma/client";
import { slackSecretFingerprint } from "~/server/app-layer/automations/slack-integration/slack-secret-fingerprint";
import { prisma } from "~/server/db";
import { decrypt, encrypt } from "~/utils/encryption";
import { migrateOrganization } from "../migrateSlackConnections";

const TOKEN = "xoxb-migration-test-token-a1b2";
const WEBHOOK = "https://hooks.slack.com/services/T0/B0/migrationtest9z8y";

describe("migrateSlackConnections", () => {
  const ns = `slackmig-${nanoid(8)}`;
  let organization: Organization | undefined;
  let team: Team | undefined;
  let projects: Project[] = [];

  const organizationId = () => organization!.id;
  const projectA = () => projects[0]!.id;
  const projectB = () => projects[1]!.id;

  const run = ({ apply }: { apply: boolean }) =>
    migrateOrganization({
      organizationId: organizationId(),
      projectIds: projects.map((project) => project.id),
      apply,
    });

  /** Returns the params as written, so assertions compare against them typed. */
  const storeAutomation = async ({
    projectId,
    actionParams,
  }: {
    projectId: string;
    actionParams: Record<string, string>;
  }) => {
    const row = await prisma.trigger.create({
      data: {
        id: nanoid(),
        name: `Slack automation ${nanoid(4)}`,
        projectId,
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams,
        filters: {},
        triggerKind: TriggerKind.AUTOMATION,
      },
    });
    return { id: row.id, projectId, actionParams };
  };

  const botWithToken = ({ projectId }: { projectId: string }) =>
    storeAutomation({
      projectId,
      actionParams: {
        slackDelivery: "bot",
        slackChannelId: "C0123",
        slackBotToken: encrypt(TOKEN),
      },
    });

  const webhook = ({ projectId }: { projectId: string }) =>
    storeAutomation({
      projectId,
      actionParams: { slackDelivery: "webhook", slackWebhook: WEBHOOK },
    });

  const connections = () =>
    prisma.slackIntegration.findMany({
      where: { organizationId: organizationId() },
    });

  const readParams = async ({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }) =>
    (await prisma.trigger.findFirstOrThrow({ where: { id, projectId } }))
      .actionParams;

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: "Slack Migration Org", slug: `--test-org-${ns}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Slack Migration Team",
        slug: `--test-team-${ns}`,
        organizationId: organization.id,
      },
    });
    projects = await Promise.all(
      ["a", "b"].map((suffix) =>
        prisma.project.create({
          data: {
            name: `Slack Migration Project ${suffix}`,
            slug: `--test-project-${ns}-${suffix}`,
            teamId: team!.id,
            language: "other",
            framework: "other",
            apiKey: `test-api-key-${ns}-${suffix}`,
          },
        }),
      ),
    );
  });

  beforeEach(async () => {
    await prisma.trigger.deleteMany({
      where: { projectId: { in: projects.map((project) => project.id) } },
    });
    await prisma.slackIntegration.deleteMany({
      where: { organizationId: organizationId() },
    });
  });

  afterAll(async () => {
    if (organization) {
      await prisma.trigger.deleteMany({
        where: { projectId: { in: projects.map((project) => project.id) } },
      });
      await prisma.slackIntegration.deleteMany({
        where: { organizationId: organization.id },
      });
    }
    for (const project of projects) {
      await prisma.project.delete({ where: { id: project.id } });
    }
    if (team) await prisma.team.delete({ where: { id: team.id } });
    if (organization) {
      await prisma.organization.delete({ where: { id: organization.id } });
    }
  });

  /** @scenario Automations sharing a secret share one connection */
  it("stores one project connection per secret and points each automation at its own", async () => {
    const bots = await Promise.all(
      [1, 2, 3].map(() => botWithToken({ projectId: projectA() })),
    );
    const hooks = await Promise.all(
      [1, 2].map(() => webhook({ projectId: projectA() })),
    );

    await run({ apply: true });

    const stored = await connections();
    expect(stored).toHaveLength(2);
    const bot = stored.find((c) => c.kind === SlackIntegrationKind.BOT);
    const hook = stored.find(
      (c) => c.kind === SlackIntegrationKind.INCOMING_WEBHOOK,
    );
    expect(bot).toMatchObject({
      scopeType: SlackIntegrationScopeType.PROJECT,
      scopeId: projectA(),
      name: "Slack bot ••••a1b2",
      secretHint: "a1b2",
      secretFingerprint: slackSecretFingerprint({ secret: TOKEN }),
      webhookUrlEncrypted: null,
      createdById: "system:migration",
    });
    expect(decrypt(bot!.botTokenEncrypted!)).toBe(TOKEN);
    expect(decrypt(hook!.webhookUrlEncrypted!)).toBe(WEBHOOK);
    for (const automation of bots) {
      expect(await readParams(automation)).toEqual({
        ...automation.actionParams,
        slackIntegrationId: bot!.id,
      });
    }
    for (const automation of hooks) {
      expect(await readParams(automation)).toMatchObject({
        slackWebhook: WEBHOOK,
        slackIntegrationId: hook!.id,
      });
    }
  });

  /** @scenario A secret shared across projects becomes an organization connection */
  it("stores one organization connection for a URL used in two projects", async () => {
    const first = await webhook({ projectId: projectA() });
    const second = await webhook({ projectId: projectB() });

    await run({ apply: true });

    const [only, ...rest] = await connections();
    expect(rest).toEqual([]);
    expect(only).toMatchObject({
      scopeType: SlackIntegrationScopeType.ORGANIZATION,
      scopeId: organizationId(),
    });
    expect(await readParams(first)).toMatchObject({
      slackIntegrationId: only!.id,
    });
    expect(await readParams(second)).toMatchObject({
      slackIntegrationId: only!.id,
    });
  });

  /** @scenario A project's existing connection absorbs matching automations */
  it("links a matching automation and a tokenless bot to the project's existing connection", async () => {
    const existing = await prisma.slackIntegration.create({
      data: {
        name: "Acme HQ",
        kind: SlackIntegrationKind.BOT,
        scopeType: SlackIntegrationScopeType.PROJECT,
        scopeId: projectA(),
        organizationId: organizationId(),
        botTokenEncrypted: encrypt(TOKEN),
        secretFingerprint: slackSecretFingerprint({ secret: TOKEN }),
        secretHint: "a1b2",
        slackTeamName: "Acme HQ",
        createdById: "user-1",
        updatedById: "user-1",
      },
    });
    const withToken = await botWithToken({ projectId: projectA() });
    const tokenless = await storeAutomation({
      projectId: projectA(),
      actionParams: { slackDelivery: "bot", slackChannelId: "C0123" },
    });

    await run({ apply: true });

    expect((await connections()).map((c) => c.id)).toEqual([existing.id]);
    expect(await readParams(withToken)).toMatchObject({
      slackIntegrationId: existing.id,
    });
    expect(await readParams(tokenless)).toMatchObject({
      slackIntegrationId: existing.id,
    });
  });

  /** @scenario The migration changes nothing unless applied, and nothing twice */
  it("writes nothing on a dry run and nothing on a second apply", async () => {
    const automation = await webhook({ projectId: projectA() });

    const dryRun = await run({ apply: false });
    expect(dryRun.linkedIds).toEqual([automation.id]);
    expect(await connections()).toEqual([]);
    expect(await readParams(automation)).toEqual(automation.actionParams);

    const first = await run({ apply: true });
    expect(first.linkedIds).toEqual([automation.id]);
    const afterFirst = await connections();

    const second = await run({ apply: true });
    expect(second.plan.connections).toEqual([]);
    expect(second.linkedIds).toEqual([]);
    expect(await connections()).toEqual(afterFirst);
  });

  it("keeps inactive automations and leaves an archived project's out of scope", async () => {
    const inactive = await webhook({ projectId: projectA() });
    await prisma.trigger.update({
      where: { id: inactive.id, projectId: projectA() },
      data: { active: false },
    });
    const archived = await webhook({ projectId: projectB() });
    await prisma.project.update({
      where: { id: projectB() },
      data: { archivedAt: new Date() },
    });

    try {
      const outcome = await run({ apply: true });

      const [only, ...rest] = await connections();
      expect(rest).toEqual([]);
      expect(only).toMatchObject({
        scopeType: SlackIntegrationScopeType.PROJECT,
        scopeId: projectA(),
      });
      expect(outcome.linkedIds).toEqual([inactive.id]);
      expect(outcome.skipped.map((s) => s.reason)).toEqual([
        "archived project",
      ]);
      expect(await readParams(archived)).toEqual(archived.actionParams);
    } finally {
      await prisma.project.update({
        where: { id: projectB() },
        data: { archivedAt: null },
      });
    }
  });

  /** @scenario A secret that cannot be decrypted is skipped, not guessed */
  it("reports an undecryptable token as skipped and leaves the automation unchanged", async () => {
    const broken = await storeAutomation({
      projectId: projectA(),
      actionParams: {
        slackDelivery: "bot",
        slackChannelId: "C0123",
        slackBotToken: "not:real:ciphertext",
      },
    });

    const outcome = await run({ apply: true });

    expect(outcome.skipped).toEqual([
      expect.objectContaining({
        automation: expect.objectContaining({ id: broken.id }),
        reason: "cannot decrypt",
      }),
    ]);
    expect(await connections()).toEqual([]);
    expect(await readParams(broken)).toEqual(broken.actionParams);
  });
});
