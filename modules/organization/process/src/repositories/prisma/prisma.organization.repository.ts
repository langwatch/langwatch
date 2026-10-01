import {
  type GuidedOnboardingRecord,
  parseGuidedOnboardingState,
  parseOnboardingVariant,
} from "@langwatch/onboarding-contract";
import {
  joinRequestApiDomainJoinSchema,
  type JoinRequestJoining,
  OrganizationHasNoTeamError,
  OrganizationNotFoundError,
  PersonalProjectNotFoundError,
  TeamNotFoundError,
  type OrganizationBillingProfile,
  type OrganizationWithAdministrators,
  type UpdateOrganizationSettingsInput,
  type PersonalFeatures,
  type PersonalWorkspace,
  type OrganizationUsageCount,
} from "@langwatch/organization-contract";
import { Prisma, type PrismaClient, type Team } from "@langwatch/prisma-client/generated";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import {
  OrganizationRepository,
  type PersonalWorkspaceFeatureProject,
  type PersonalWorkspaceResourceIds,
  type StoredOrganizationSettings,
} from "../organization.repository.ts";

type Client = Prisma.TransactionClient | PrismaClient;

export class PrismaOrganizationRepository extends OrganizationRepository {
  private constructor(private readonly database: PrismaClient) {
    super();
  }

  static create(database: PrismaClient): PrismaOrganizationRepository {
    return new PrismaOrganizationRepository(database);
  }

  async findAllIds(): Promise<string[]> {
    const rows = await this.database.organization.findMany({ select: { id: true } });
    return rows.map((row) => row.id);
  }

  async countUsage({
    organizationIds,
  }: {
    organizationIds: readonly string[];
  }): Promise<OrganizationUsageCount> {
    const scope = { organizationId: { in: [...organizationIds] } };
    const [members, teams, organizations, firstTwo] = await Promise.all([
      this.database.organizationUser.count({ where: scope }),
      this.database.team.count({ where: scope }),
      this.database.organization.findMany({
        where: { id: { in: [...organizationIds] } },
        select: { ssoProvider: true },
      }),
      this.database.organizationUser.findMany({
        where: scope,
        orderBy: { createdAt: "asc" },
        take: 2,
        select: { createdAt: true },
      }),
    ]);
    const second = firstTwo[1];
    return {
      members,
      teams,
      ssoProviders: organizations.flatMap((row) => (row.ssoProvider ? [row.ssoProvider] : [])),
      ...(second ? { secondMemberJoinedAt: second.createdAt.getTime() } : {}),
    };
  }

  async getJoinSetting({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<JoinRequestJoining> {
    const row = await this.database.organization.findUnique({
      where: { id: organizationId },
      select: { domainJoin: true, joinDomains: true },
    });
    if (!row) throw new OrganizationNotFoundError();

    const domainJoin = joinRequestApiDomainJoinSchema.safeParse(row.domainJoin);
    return {
      domainJoin: domainJoin.success ? domainJoin.data : "request",
      joinDomains: row.joinDomains,
    };
  }

  async getSessionPolicy({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ maxSessionDurationDays: number }> {
    const row = await this.database.organization.findUnique({
      where: { id: organizationId },
      select: { maxSessionDurationDays: true },
    });
    return { maxSessionDurationDays: row?.maxSessionDurationDays ?? 0 };
  }

  async saveSessionPolicy({
    organizationId,
    maxSessionDurationDays,
  }: {
    organizationId: string;
    maxSessionDurationDays: number;
  }): Promise<void> {
    await this.database.organization.update({
      where: { id: organizationId },
      data: { maxSessionDurationDays },
    });
  }

  async saveJoinSetting({
    organizationId,
    setting,
  }: {
    organizationId: string;
    setting: JoinRequestJoining;
  }): Promise<void> {
    await this.database.organization.update({
      where: { id: organizationId },
      data: { domainJoin: setting.domainJoin, joinDomains: setting.joinDomains },
    });
  }

  async getGuidedOnboarding({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<GuidedOnboardingRecord> {
    const signupData = await this.readSignupData(organizationId);

    return {
      state: parseGuidedOnboardingState(signupData),
      variant: parseOnboardingVariant(signupData),
    };
  }

  /**
   * The two keys upstream writes and nothing else: every other sign-up answer
   * on the row is carried through untouched, so a welcome flow saving its
   * progress never erases what the sign-up form collected.
   */
  async saveGuidedOnboarding({
    organizationId,
    record,
  }: {
    organizationId: string;
    record: GuidedOnboardingRecord;
  }): Promise<GuidedOnboardingRecord> {
    const signupData = await this.readSignupData(organizationId);
    const held =
      signupData && typeof signupData === "object" && !Array.isArray(signupData)
        ? (signupData as Record<string, unknown>)
        : {};

    await this.database.organization.update({
      where: { id: organizationId },
      data: {
        signupData: {
          ...held,
          guidedOnboarding: record.state,
          onboardingVariant: record.variant,
        } as Prisma.InputJsonValue,
      },
    });

    return record;
  }

  /** The column, with the refusal an unknown organization earns. */
  private async readSignupData(organizationId: string): Promise<unknown> {
    const organization = await this.database.organization.findUnique({
      where: { id: organizationId },
      select: { signupData: true },
    });
    if (!organization) throw new OrganizationNotFoundError();

    return organization.signupData;
  }

  async findStoredSettings(organizationId: string): Promise<StoredOrganizationSettings | null> {
    return this.database.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        supportContact: true,
        presenceEnabled: true,
        traceSharingEnabled: true,
        primaryIntent: true,
        s3Endpoint: true,
        s3AccessKeyId: true,
        s3Bucket: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * `input`'s `s3Endpoint`/`s3AccessKeyId`/`s3SecretAccessKey` already carry
   * whatever the caller wants stored (the service encrypts before calling):
   * persistence stores columns, it does not decide what they mean.
   */
  async updateSettings(input: UpdateOrganizationSettingsInput): Promise<void> {
    await this.database.organization.update({
      where: { id: input.organizationId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.supportContact !== undefined
          ? { supportContact: input.supportContact?.trim() || null }
          : {}),
        ...(input.presenceEnabled !== undefined ? { presenceEnabled: input.presenceEnabled } : {}),
        ...(input.traceSharingEnabled !== undefined
          ? { traceSharingEnabled: input.traceSharingEnabled }
          : {}),
        ...(input.primaryIntent !== undefined ? { primaryIntent: input.primaryIntent } : {}),
        ...(input.s3Endpoint !== undefined ? { s3Endpoint: input.s3Endpoint } : {}),
        ...(input.s3AccessKeyId !== undefined ? { s3AccessKeyId: input.s3AccessKeyId } : {}),
        ...(input.s3SecretAccessKey !== undefined
          ? { s3SecretAccessKey: input.s3SecretAccessKey }
          : {}),
        ...(input.s3Bucket !== undefined ? { s3Bucket: input.s3Bucket || null } : {}),
      },
    });
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

  async getWithAdministrators(organizationId: string): Promise<OrganizationWithAdministrators> {
    const organization = await this.database.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        sentPlanLimitAlert: true,
        members: {
          where: { role: "ADMIN" },
          select: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    if (!organization) throw new OrganizationNotFoundError();
    return {
      id: organization.id,
      name: organization.name,
      sentPlanLimitAlert:
        organization.sentPlanLimitAlert && fromDate(organization.sentPlanLimitAlert),
      administrators: organization.members.map(({ user }) => ({
        userId: user.id,
        name: user.name,
        email: user.email,
      })),
    };
  }

  async updateSentPlanLimitAlert(input: {
    organizationId: string;
    sentAt: Instant;
  }): Promise<void> {
    await this.database.organization.update({
      where: { id: input.organizationId },
      data: { sentPlanLimitAlert: toDate(input.sentAt) },
    });
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
    // The condition sits on the table, not in `updateMany`'s subquery: a write
    // parked on the row lock re-checks it against the committed row, so only
    // one of two checkouts started together is told it won.
    const updated = await this.database.$executeRaw`
      -- @tenancy: an organization is addressed by its own primary key.
      UPDATE "Organization"
         SET "stripeCustomerId" = ${input.billingCustomerId},
             "updatedAt" = now()
       WHERE "id" = ${input.organizationId}
         AND "stripeCustomerId" IS NULL
    `;
    return updated > 0;
  }

  async getPersonalWorkspace(input: {
    userId: string;
    organizationId: string;
  }): Promise<PersonalWorkspace> {
    const workspace = await this.tryFindWorkspace(this.database, input);
    if (!workspace) throw new TeamNotFoundError();
    return workspace;
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

        const reactivated = await this.tryReactivateWorkspace(transaction, input.workspace);
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
    const displayLabel = input.displayName?.trim() || input.displayEmail?.split("@")[0] || "user";
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
