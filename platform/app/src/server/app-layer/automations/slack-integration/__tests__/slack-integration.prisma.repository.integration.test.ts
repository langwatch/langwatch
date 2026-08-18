/**
 * The Slack integration's storage against a real database, because the two
 * claims that matter here are claims about rows: that one project holds exactly
 * one integration however many times it is saved, and that the tenancy regime
 * accepts the queries this repository actually issues. An org-scoped model
 * outside every regime makes every query throw, and a mock cannot notice.
 *
 * The legacy-token half is here for the same reason: clearing a token is a
 * surgical edit inside a JSON column, and "the other fields survived" is only
 * true if the stored row says so.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type Organization,
  type Project,
  type Team,
  TriggerAction,
  TriggerKind,
} from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { PrismaSlackIntegrationRepository } from "../repositories/slack-integration.prisma.repository";

describe("Feature: the project's Slack integration", () => {
  const ns = `slackint-${nanoid(8)}`;

  let organization: Organization | undefined;
  let team: Team | undefined;
  let project: Project | undefined;
  let repo: PrismaSlackIntegrationRepository;

  const projectId = () => project!.id;

  const storeSlackAutomation = (params: {
    slackBotToken?: string;
    channelId?: string;
  }) =>
    prisma.trigger.create({
      data: {
        id: nanoid(),
        name: `Slack automation ${nanoid(4)}`,
        projectId: projectId(),
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: {
          slackDelivery: "bot",
          slackChannelId: params.channelId ?? "C0123",
          ...(params.slackBotToken
            ? { slackBotToken: params.slackBotToken }
            : {}),
        },
        filters: {},
        triggerKind: TriggerKind.AUTOMATION,
      },
    });

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: "Slack Integration Org", slug: `--test-org-${ns}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Slack Integration Team",
        slug: `--test-team-${ns}`,
        organizationId: organization.id,
      },
    });
    project = await prisma.project.create({
      data: {
        name: "Slack Integration Project",
        slug: `--test-project-${ns}`,
        teamId: team.id,
        language: "other",
        framework: "other",
        apiKey: `test-api-key-${ns}`,
      },
    });
    repo = new PrismaSlackIntegrationRepository(prisma);
  });

  beforeEach(async () => {
    if (!project) return;
    await prisma.trigger.deleteMany({ where: { projectId: project.id } });
    await prisma.slackIntegration.deleteMany({
      where: { scopeType: "PROJECT", scopeId: project.id },
    });
  });

  afterAll(async () => {
    if (project) {
      await prisma.slackIntegration.deleteMany({
        where: { scopeType: "PROJECT", scopeId: project.id },
      });
      await prisma.trigger.deleteMany({ where: { projectId: project.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
    if (team) await prisma.team.delete({ where: { id: team.id } });
    if (organization) {
      await prisma.organization.delete({ where: { id: organization.id } });
    }
  });

  const connect = ({
    botTokenEncrypted,
    slackTeamName = "Acme HQ",
  }: {
    botTokenEncrypted: string;
    slackTeamName?: string;
  }) =>
    repo.upsertForProject({
      projectId: projectId(),
      organizationId: organization!.id,
      botTokenEncrypted,
      slackTeamId: "T123",
      slackTeamName,
      userId: "user-1",
    });

  describe("when a project is connected twice", () => {
    /** @scenario "Rotating the token needs no automation edits" */
    it("holds one row, carrying the newest token", async () => {
      await connect({ botTokenEncrypted: "enc(xoxb-old)" });
      await connect({
        botTokenEncrypted: "enc(xoxb-new)",
        slackTeamName: "Acme HQ renamed",
      });

      const rows = await prisma.slackIntegration.findMany({
        where: { scopeType: "PROJECT", scopeId: projectId() },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.botTokenEncrypted).toBe("enc(xoxb-new)");
      expect(rows[0]?.slackTeamName).toBe("Acme HQ renamed");
    });
  });

  describe("when the project has no integration", () => {
    it("reads back as absent rather than throwing", async () => {
      expect(await repo.findByProject({ projectId: projectId() })).toBeNull();
    });
  });

  describe("when automations in the project store their own token", () => {
    /** @scenario "Settings counts the automations still on their own token" */
    it("finds only the ones that actually carry one", async () => {
      await storeSlackAutomation({ slackBotToken: "enc(xoxb-a)" });
      await storeSlackAutomation({ slackBotToken: "enc(xoxb-b)" });
      await storeSlackAutomation({});

      const legacy = await repo.findAllWithOwnSlackToken({
        projectId: projectId(),
      });

      expect(legacy).toHaveLength(2);
    });

    /** @scenario "Switching a legacy automation to the project integration" */
    it("clears the token and leaves the rest of the delivery alone", async () => {
      const row = await storeSlackAutomation({
        slackBotToken: "enc(xoxb-a)",
        channelId: "C0999",
      });

      const outcome = await repo.clearOwnSlackToken({
        projectId: projectId(),
        triggerId: row.id,
      });

      expect(outcome).toBe("cleared");
      const after = await prisma.trigger.findUniqueOrThrow({
        where: { id: row.id, projectId: projectId() },
      });
      expect(after.actionParams).toEqual({
        slackDelivery: "bot",
        slackChannelId: "C0999",
      });
    });

    /** @scenario "Bulk-switching clears each automation independently" */
    it("reports an automation with nothing to clear as already clear", async () => {
      const row = await storeSlackAutomation({});

      expect(
        await repo.clearOwnSlackToken({
          projectId: projectId(),
          triggerId: row.id,
        }),
      ).toBe("already_clear");
    });
  });

  describe("when the integration is removed", () => {
    it("leaves the project with none", async () => {
      await connect({ botTokenEncrypted: "enc(xoxb-live)" });

      await repo.deleteForProject({ projectId: projectId() });

      expect(await repo.findByProject({ projectId: projectId() })).toBeNull();
    });
  });
});
