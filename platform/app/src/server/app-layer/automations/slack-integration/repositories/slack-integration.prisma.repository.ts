import type { PrismaClient, SlackIntegration } from "~/generated/prisma/client";
import { TriggerAction } from "~/generated/prisma/client";
import { isUniqueConstraintError } from "~/server/utils/prismaErrors";
import type {
  SlackConnectionChanges,
  SlackConnectionRecord,
  SlackIntegrationRepository,
  SlackProjectScope,
} from "./slack-integration.repository";

/** The connection an automation's stored params point at, read without a cast. */
const connectionIdOf = (actionParams: unknown): string | null =>
  typeof actionParams === "object" &&
  actionParams !== null &&
  "slackIntegrationId" in actionParams &&
  typeof actionParams.slackIntegrationId === "string"
    ? actionParams.slackIntegrationId
    : null;

export class PrismaSlackIntegrationRepository
  implements SlackIntegrationRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findProjectScope({
    projectId,
  }: {
    projectId: string;
  }): Promise<SlackProjectScope | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        team: {
          select: { organization: { select: { id: true, name: true } } },
        },
      },
    });
    const organization = project?.team?.organization;
    if (!project || !organization) return null;
    return {
      projectId: project.id,
      projectName: project.name,
      organizationId: organization.id,
      organizationName: organization.name,
    };
  }

  async findById({ id }: { id: string }): Promise<SlackIntegration | null> {
    return this.prisma.slackIntegration.findUnique({ where: { id } });
  }

  async findAllUsableByProject({
    organizationId,
    projectId,
  }: {
    organizationId: string;
    projectId: string;
  }): Promise<SlackIntegration[]> {
    return this.prisma.slackIntegration.findMany({
      where: {
        organizationId,
        OR: [
          { scopeType: "ORGANIZATION", scopeId: organizationId },
          { scopeType: "PROJECT", scopeId: projectId },
        ],
      },
      orderBy: [{ name: "asc" }, { createdAt: "asc" }],
    });
  }

  async findByFingerprint({
    organizationId,
    secretFingerprint,
  }: {
    organizationId: string;
    secretFingerprint: string;
  }): Promise<SlackIntegration | null> {
    return this.prisma.slackIntegration.findUnique({
      where: {
        organizationId_secretFingerprint: { organizationId, secretFingerprint },
      },
    });
  }

  async create({
    record,
    actorId,
  }: {
    record: SlackConnectionRecord;
    actorId: string;
  }): Promise<SlackIntegration | null> {
    try {
      return await this.prisma.slackIntegration.create({
        data: { ...record, createdById: actorId, updatedById: actorId },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) return null;
      throw error;
    }
  }

  async update({
    id,
    organizationId,
    changes,
    actorId,
  }: {
    id: string;
    organizationId: string;
    changes: SlackConnectionChanges;
    actorId: string;
  }): Promise<SlackIntegration | null> {
    try {
      return await this.prisma.slackIntegration.update({
        where: { id, organizationId },
        data: { ...changes, updatedById: actorId },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) return null;
      throw error;
    }
  }

  async delete({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<void> {
    await this.prisma.slackIntegration.deleteMany({
      where: { id, organizationId },
    });
  }

  /**
   * Counted in memory: the connection id lives inside the provider payload, not
   * a column, and an organization's Slack automations are counted in tens.
   */
  async countDependentAutomations({
    organizationId,
    ids,
  }: {
    organizationId: string;
    ids: string[];
  }): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (ids.length === 0) return counts;
    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });
    if (projects.length === 0) return counts;
    const rows = await this.prisma.trigger.findMany({
      where: {
        projectId: { in: projects.map((project) => project.id) },
        action: TriggerAction.SEND_SLACK_MESSAGE,
        active: true,
        deleted: false,
      },
      select: { actionParams: true },
    });
    const wanted = new Set(ids);
    for (const row of rows) {
      const id = connectionIdOf(row.actionParams);
      if (id && wanted.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }
}
