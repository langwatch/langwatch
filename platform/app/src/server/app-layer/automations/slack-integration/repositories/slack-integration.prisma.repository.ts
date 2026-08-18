import type { SlackActionParams } from "@langwatch/automations/providers/slack";
import type { PrismaClient, SlackIntegration } from "~/generated/prisma/client";
import { TriggerAction } from "~/generated/prisma/client";
import type {
  ClearOwnSlackTokenOutcome,
  LegacySlackTokenAutomation,
  SlackIntegrationRepository,
} from "./slack-integration.repository";

/** The scope pair a project-scoped integration is stored under. */
const projectScope = (projectId: string) => ({
  scopeType: "PROJECT" as const,
  scopeId: projectId,
});

export class PrismaSlackIntegrationRepository
  implements SlackIntegrationRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findByProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<SlackIntegration | null> {
    return this.prisma.slackIntegration.findUnique({
      where: { scopeType_scopeId: projectScope(projectId) },
    });
  }

  async upsertForProject({
    projectId,
    organizationId,
    botTokenEncrypted,
    slackTeamId,
    slackTeamName,
    userId,
  }: {
    projectId: string;
    organizationId: string;
    botTokenEncrypted: string;
    slackTeamId: string;
    slackTeamName: string;
    userId: string;
  }): Promise<SlackIntegration> {
    return this.prisma.slackIntegration.upsert({
      where: { scopeType_scopeId: projectScope(projectId) },
      create: {
        ...projectScope(projectId),
        organizationId,
        botTokenEncrypted,
        slackTeamId,
        slackTeamName,
        createdById: userId,
        updatedById: userId,
      },
      update: {
        organizationId,
        botTokenEncrypted,
        slackTeamId,
        slackTeamName,
        updatedById: userId,
      },
    });
  }

  async deleteForProject({ projectId }: { projectId: string }): Promise<void> {
    await this.prisma.slackIntegration.deleteMany({
      where: projectScope(projectId),
    });
  }

  /**
   * Read the project's Slack automations and keep the ones carrying a token.
   * The filter is in memory rather than a JSON-path predicate because the
   * stored shape is a provider payload, not a column: a `slackBotToken` key
   * present but empty means the same as absent, and a path filter cannot say
   * so. A project's automations are counted in tens.
   */
  async findAllWithOwnSlackToken({
    projectId,
  }: {
    projectId: string;
  }): Promise<LegacySlackTokenAutomation[]> {
    const rows = await this.prisma.trigger.findMany({
      where: {
        projectId,
        deleted: false,
        action: TriggerAction.SEND_SLACK_MESSAGE,
      },
      select: { id: true, name: true, actionParams: true },
      orderBy: { createdAt: "asc" },
    });
    return rows
      .filter((row) => {
        const params = (row.actionParams ?? {}) as Partial<SlackActionParams>;
        return typeof params.slackBotToken === "string" && params.slackBotToken;
      })
      .map(({ id, name }) => ({ id, name }));
  }

  async clearOwnSlackToken({
    projectId,
    triggerId,
  }: {
    projectId: string;
    triggerId: string;
  }): Promise<ClearOwnSlackTokenOutcome> {
    // Optimistic read-modify-write: the JSON value is replaced whole, so the
    // write only lands if the row is still the one that was read — otherwise
    // it would silently undo a concurrent edit to the channel or templates.
    // A lost race re-reads and tries again; the token being gone by then is
    // the outcome the caller wanted anyway.
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await this.prisma.trigger.findFirst({
        where: { id: triggerId, projectId, deleted: false },
        select: { actionParams: true, updatedAt: true },
      });
      if (!row) return "failed";
      const params = (row.actionParams ?? {}) as Partial<SlackActionParams>;
      if (!params.slackBotToken) return "already_clear";
      const { slackBotToken: _cleared, ...rest } = params;
      const updated = await this.prisma.trigger.updateMany({
        where: { id: triggerId, projectId, updatedAt: row.updatedAt },
        data: { actionParams: rest },
      });
      if (updated.count === 1) return "cleared";
    }
    return "failed";
  }
}
