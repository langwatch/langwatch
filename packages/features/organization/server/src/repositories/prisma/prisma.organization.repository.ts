import {
  OrganizationHasNoTeamError,
  OrganizationNotFoundError,
  PersonalProjectNotFoundError,
  type OrganizationBillingProfile,
  type PersonalFeatures,
  type PersonalWorkspace,
} from "@langwatch/organization-contract";
import { Prisma, type PrismaClient, type Team } from "@langwatch/prisma-client/generated";
import {
  OrganizationRepository,
  type PersonalWorkspaceFeatureProject,
  type PersonalWorkspaceResourceIds,
} from "../../ports/organization.port";

type Client = Prisma.TransactionClient | PrismaClient;

export class PrismaOrganizationRepository extends OrganizationRepository {
  private constructor(private readonly database: PrismaClient) {
    super();
  }

  static create(database: object): PrismaOrganizationRepository {
    return new PrismaOrganizationRepository(database as PrismaClient);
  }

  async getOldestTeamId(organizationId: string): Promise<string> {
    const team = await this.database.team.findFirst({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!team) throw new OrganizationHasNoTeamError(organizationId);
    return team.id;
  }

  async getBillingProfile(organizationId: string): Promise<OrganizationBillingProfile> {
    const organization = await this.database.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, stripeCustomerId: true },
    });
    if (!organization) throw new OrganizationNotFoundError();
    return {
      id: organization.id,
      name: organization.name,
      billingCustomerId: organization.stripeCustomerId,
    };
  }

  async claimBillingCustomerId(input: {
    organizationId: string;
    billingCustomerId: string;
  }): Promise<boolean> {
    const result = await this.database.organization.updateMany({
      where: { id: input.organizationId, stripeCustomerId: null },
      data: { stripeCustomerId: input.billingCustomerId },
    });
    return result.count > 0;
  }

  tryFindPersonalWorkspace(input: {
    userId: string;
    organizationId: string;
  }): Promise<PersonalWorkspace | null> {
    return this.tryFindWorkspace(this.database, input);
  }

  async ensurePersonalWorkspace(input: {
    workspace: {
      userId: string;
      organizationId: string;
      displayName?: string | null;
      displayEmail?: string | null;
    };
    resources: PersonalWorkspaceResourceIds;
  }): Promise<{
    workspace: PersonalWorkspace;
    created: boolean;
  }> {
    try {
      return await this.database.$transaction(async (transaction) => {
        const existing = await this.tryFindWorkspace(transaction, input.workspace);
        if (existing) {
          return {
            workspace: existing,
            created: false,
          };
        }

        const reactivated = await this.tryReactivateWorkspace(
          transaction,
          input.workspace,
        );
        if (reactivated) {
          return {
            workspace: reactivated,
            created: false,
          };
        }

        const workspace = await this.createPersonalWorkspace(
          transaction,
          input.workspace,
          input.resources,
        );
        return {
          workspace,
          created: true,
        };
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const winner = await this.tryFindWorkspace(this.database, input.workspace);
      if (!winner) throw error;
      return {
        workspace: winner,
        created: false,
      };
    }
  }

  async getPersonalWorkspaceFeatureProject(
    projectId: string,
  ): Promise<PersonalWorkspaceFeatureProject> {
    const project = await this.database.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        isPersonal: true,
        ownerUserId: true,
        personalFeatures: true,
        team: { select: { organizationId: true } },
      },
    });
    if (!project) throw new PersonalProjectNotFoundError(projectId);
    return {
      id: project.id,
      isPersonal: project.isPersonal,
      ownerUserId: project.ownerUserId,
      organizationId: project.team?.organizationId ?? null,
      personalFeatures: project.personalFeatures,
    };
  }

  async setPersonalWorkspaceFeaturesWithAudit(input: {
    projectId: string;
    callerUserId: string;
    organizationId: string | null;
    action: string;
    before: PersonalFeatures;
    after: PersonalFeatures;
  }): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await transaction.project.update({
        where: { id: input.projectId },
        data: { personalFeatures: input.after },
      });
      await transaction.auditLog.create({
        data: {
          userId: input.callerUserId,
          projectId: input.projectId,
          organizationId: input.organizationId,
          action: input.action,
          targetKind: "project",
          targetId: input.projectId,
          before: input.before as Prisma.InputJsonValue,
          after: input.after as Prisma.InputJsonValue,
        },
      });
    });
  }

  private async createPersonalWorkspace(
    transaction: Prisma.TransactionClient,
    input: {
      userId: string;
      organizationId: string;
      displayName?: string | null;
      displayEmail?: string | null;
    },
    resources: PersonalWorkspaceResourceIds,
  ): Promise<PersonalWorkspace> {
    const displayLabel =
      input.displayName?.trim() || input.displayEmail?.split("@")[0] || "user";
    const team = await transaction.team.create({
      data: {
        id: resources.teamId,
        name: `${displayLabel}'s Workspace`,
        slug: resources.teamSlug,
        organizationId: input.organizationId,
        isPersonal: true,
        ownerUserId: input.userId,
      },
    });
    const project = await transaction.project.create({
      data: {
        id: resources.projectId,
        name: "Personal Workspace",
        slug: resources.projectSlug,
        apiKey: resources.projectApiKey,
        teamId: team.id,
        language: "other",
        framework: "other",
        isPersonal: true,
        ownerUserId: input.userId,
      },
    });
    await transaction.teamUser.create({
      data: { userId: input.userId, teamId: team.id, role: "ADMIN" },
    });
    return mapPersonalWorkspace(team, project);
  }

  private async tryReactivateWorkspace(
    transaction: Prisma.TransactionClient,
    input: { userId: string; organizationId: string },
  ): Promise<PersonalWorkspace | null> {
    const archived = await transaction.team.findFirst({
      where: {
        organizationId: input.organizationId,
        ownerUserId: input.userId,
        isPersonal: true,
        archivedAt: { not: null },
      },
      select: {
        id: true,
        projects: {
          where: { isPersonal: true },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!archived || archived.projects.length === 0) return null;
    await transaction.team.update({
      where: { id: archived.id },
      data: { archivedAt: null },
    });
    await transaction.project.updateMany({
      where: { teamId: archived.id, isPersonal: true },
      data: { archivedAt: null },
    });
    return this.tryFindWorkspace(transaction, input);
  }

  private async tryFindWorkspace(
    client: Client,
    input: { userId: string; organizationId: string },
  ): Promise<PersonalWorkspace | null> {
    const team = await client.team.findFirst({
      where: {
        organizationId: input.organizationId,
        ownerUserId: input.userId,
        isPersonal: true,
        archivedAt: null,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        projects: {
          where: { isPersonal: true, archivedAt: null },
          select: {
            id: true,
            name: true,
            slug: true,
            apiKey: true,
            createdAt: true,
          },
          take: 1,
        },
      },
    });
    if (!team || team.projects.length === 0) return null;
    return mapPersonalWorkspace(team, team.projects[0]!);
  }
}
function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function mapPersonalWorkspace(
  team: Pick<Team, "id" | "name" | "slug" | "createdAt">,
  project: {
    id: string;
    name: string;
    slug: string;
    apiKey: string;
    createdAt: Date;
  },
): PersonalWorkspace {
  return {
    team: {
      id: team.id,
      name: team.name,
      slug: team.slug,
      createdAtMs: team.createdAt.getTime(),
    },
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      apiKey: project.apiKey,
      createdAtMs: project.createdAt.getTime(),
    },
  };
}
