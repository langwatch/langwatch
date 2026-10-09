import { readJoinerRole } from "@langwatch/identity-contract";
import {
  type GuidedOnboardingRecord,
  parseGuidedOnboardingState,
  parseOnboardingVariant,
} from "@langwatch/onboarding-contract";
import {
  organizationJoinSettingSchema,
  type OrganizationJoinSetting,
  OrganizationHasNoTeamError,
  OrganizationNotFoundError,
  PersonalProjectNotFoundError,
  TeamNotFoundError,
  type OrganizationBillingProfile,
  type OrganizationWithAdministrators,
  type UpdateOrganizationSettingsInput,
  type PersonalFeatures,
  type PersonalWorkspace,
  type OrganizationIdPage,
  type OrganizationIdPageInput,
  type OrganizationUsageCount,
  type PricingModel,
  type SignInSecurityPolicy,
  type OrganizationCurrency,
} from "@langwatch/organization-contract";
import { Prisma, type PrismaClient, type Team } from "@langwatch/prisma-client/generated";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import {
  OrganizationRepository,
  type OrganizationSettingsCipher,
  type PersonalWorkspaceFeatureProject,
  type PersonalWorkspaceResourceIds,
  type EnsuredPersonalTeam,
  type StoredOrganizationSettings,
  type OrganizationTeamProject,
} from "../organization.repository.ts";
import { PrismaOrganizationAuditStore } from "./prisma.organization-audit.store.ts";

type Client = Prisma.TransactionClient | PrismaClient;

const BYTES_PER_MEBIBYTE = 1024 * 1024;

const signInSecurityPolicySelect = {
  lockoutAfterFailedAttempts: true,
  lockoutMinutes: true,
  sessionIdleTimeoutMinutes: true,
  sessionMaxLifetimeMinutes: true,
} as const;

export class PrismaOrganizationRepository extends OrganizationRepository {
  private constructor(
    private readonly database: PrismaClient,
    private readonly cipher: OrganizationSettingsCipher,
    private readonly audit: PrismaOrganizationAuditStore,
  ) {
    super();
  }

  static create({
    database,
    cipher,
  }: {
    database: PrismaClient;
    cipher: OrganizationSettingsCipher;
  }): PrismaOrganizationRepository {
    return new PrismaOrganizationRepository(
      database,
      cipher,
      PrismaOrganizationAuditStore.create({ database }),
    );
  }

  async listAllIds({ after, limit }: OrganizationIdPageInput = {}): Promise<OrganizationIdPage> {
    const rows = await this.database.organization.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
      ...(after === undefined ? {} : { where: { id: { gt: after } } }),
      ...(limit === undefined ? {} : { take: limit + 1 }),
    });
    const ids = rows.map((row) => row.id);
    if (limit === undefined || ids.length <= limit) return { ids, next: null };
    const page = ids.slice(0, limit);
    return { ids: page, next: page[page.length - 1] ?? null };
  }

  async countUsage({
    organizationIds,
  }: {
    organizationIds: readonly string[];
  }): Promise<OrganizationUsageCount> {
    if (organizationIds.length === 0) return { members: 0, teams: 0, ssoProviders: [] };
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
  }): Promise<OrganizationJoinSetting> {
    const row = await this.database.organization.findUnique({
      where: { id: organizationId },
      select: { domainJoin: true, joinDomains: true, joinerRole: true },
    });
    if (!row) throw new OrganizationNotFoundError();

    const domainJoin = organizationJoinSettingSchema.shape.domainJoin.safeParse(row.domainJoin);
    return {
      domainJoin: domainJoin.success ? domainJoin.data : "request",
      joinDomains: row.joinDomains,
      joinerRole: readJoinerRole(row.joinerRole),
    };
  }

  async findBySsoDomain({
    domain,
  }: {
    domain: string;
  }): Promise<{ id: string; name: string; ssoProvider: string | null } | null> {
    return this.database.organization.findUnique({
      where: { ssoDomain: domain },
      select: { id: true, name: true, ssoProvider: true },
    });
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

  async getSignInSecurityPolicy({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SignInSecurityPolicy> {
    const row = await this.database.organization.findUnique({
      where: { id: organizationId },
      select: signInSecurityPolicySelect,
    });
    if (!row) throw new OrganizationNotFoundError();
    return row;
  }

  async updateSignInSecurityPolicy({
    organizationId,
    policy,
  }: {
    organizationId: string;
    policy: SignInSecurityPolicy;
  }): Promise<void> {
    await this.database.organization.update({ where: { id: organizationId }, data: policy });
  }

  async findSignInSecurityPoliciesForUser({
    userId,
  }: {
    userId: string;
  }): Promise<SignInSecurityPolicy[]> {
    // Through `Organization` filtered by membership, never `OrganizationUser`
    // keyed only by `userId`: the org-tenancy guard refuses that (ADR-021).
    return this.database.organization.findMany({
      where: { members: { some: { userId, disabledAt: null } } },
      select: signInSecurityPolicySelect,
    });
  }

  async findConfiguredSignInSecurityPolicies(): Promise<SignInSecurityPolicy[]> {
    return this.database.organization.findMany({
      where: {
        OR: [
          { lockoutAfterFailedAttempts: { gt: 0 } },
          { sessionIdleTimeoutMinutes: { gt: 0 } },
          { sessionMaxLifetimeMinutes: { gt: 0 } },
        ],
      },
      select: signInSecurityPolicySelect,
    });
  }

  async getPricing({ organizationId }: { organizationId: string }): Promise<{
    pricingModel: PricingModel | null;
    currency: "USD" | "EUR";
  }> {
    const row = await this.database.organization.findUnique({
      where: { id: organizationId },
      select: { pricingModel: true, currency: true },
    });
    return { pricingModel: row?.pricingModel ?? null, currency: row?.currency ?? "EUR" };
  }

  async getDatasetLimits({ organizationId }: { organizationId: string }): Promise<{
    attachmentMaxBytes: number | null;
  }> {
    const row = await this.database.organization.findUnique({
      where: { id: organizationId },
      select: { datasetAttachmentMaxMb: true },
    });
    const megabytes = row?.datasetAttachmentMaxMb ?? null;
    return { attachmentMaxBytes: megabytes === null ? null : megabytes * BYTES_PER_MEBIBYTE };
  }

  async isInstantEvalsOptedIn({ organizationId }: { organizationId: string }): Promise<boolean> {
    const row = await this.database.organization.findUnique({
      where: { id: organizationId },
      select: { instantEvalsEnabledAt: true },
    });
    return !!row?.instantEvalsEnabledAt;
  }

  async recordInstantEvalsOptIn(input: {
    organizationId: string;
    userId: string;
    at: Instant;
  }): Promise<void> {
    // The condition sits on the table, as in billing's Stripe customer claim: a second
    // click parked on the row lock re-checks it and keeps the first record.
    await this.database.$executeRaw`
      -- @tenancy: an organization is addressed by its own primary key.
      UPDATE "Organization"
         SET "instantEvalsEnabledAt" = ${toDate(input.at)},
             "instantEvalsEnabledByUserId" = ${input.userId},
             "updatedAt" = now()
       WHERE "id" = ${input.organizationId}
         AND "instantEvalsEnabledAt" IS NULL
    `;
  }

  async saveJoinSetting({
    organizationId,
    setting,
  }: {
    organizationId: string;
    setting: OrganizationJoinSetting;
  }): Promise<void> {
    await this.database.organization.update({
      where: { id: organizationId },
      data: {
        domainJoin: setting.domainJoin,
        joinDomains: setting.joinDomains,
        joinerRole: setting.joinerRole,
      },
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

  async hasStoredS3Secret(organizationId: string): Promise<boolean> {
    const row = await this.database.organization.findUnique({
      where: { id: organizationId },
      select: { s3SecretAccessKey: true },
    });

    return !!row?.s3SecretAccessKey;
  }

  async findStoredSettings(organizationId: string): Promise<StoredOrganizationSettings | null> {
    const stored = await this.database.organization.findUnique({
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
    if (!stored) return null;

    return {
      ...stored,
      s3Endpoint: stored.s3Endpoint ? this.cipher.decrypt(stored.s3Endpoint) : null,
      s3AccessKeyId: stored.s3AccessKeyId ? this.cipher.decrypt(stored.s3AccessKeyId) : null,
    };
  }

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
        ...(input.s3Endpoint !== undefined
          ? { s3Endpoint: this.#sealOrNull(input.s3Endpoint) }
          : {}),
        ...(input.s3AccessKeyId !== undefined
          ? { s3AccessKeyId: this.#sealOrNull(input.s3AccessKeyId) }
          : {}),
        ...(input.s3SecretAccessKey !== undefined
          ? { s3SecretAccessKey: this.#sealOrNull(input.s3SecretAccessKey) }
          : {}),
        ...(input.s3Bucket !== undefined ? { s3Bucket: input.s3Bucket || null } : {}),
      },
    });
  }

  #sealOrNull(value: string | null): string | null {
    return value ? this.cipher.encrypt(value) : null;
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
    const { count } = await this.database.organization.updateMany({
      where: { id: input.organizationId },
      data: { sentPlanLimitAlert: toDate(input.sentAt) },
    });
    if (count === 0) throw new OrganizationNotFoundError();
  }

  async updateCurrency(input: {
    organizationId: string;
    currency: OrganizationCurrency;
  }): Promise<void> {
    const { count } = await this.database.organization.updateMany({
      where: { id: input.organizationId },
      data: { currency: input.currency },
    });
    if (count === 0) throw new OrganizationNotFoundError();
  }

  async updatePricingModel(input: {
    organizationId: string;
    pricingModel: PricingModel;
  }): Promise<void> {
    const { count } = await this.database.organization.updateMany({
      where: { id: input.organizationId },
      data: { pricingModel: input.pricingModel },
    });
    if (count === 0) throw new OrganizationNotFoundError();
  }

  async setLicense(input: {
    organizationId: string;
    licenseKey: string;
    expiresAt: Instant;
    validatedAt: Instant | null;
  }): Promise<void> {
    const { count } = await this.database.organization.updateMany({
      where: { id: input.organizationId },
      data: {
        license: input.licenseKey,
        licenseExpiresAt: toDate(input.expiresAt),
        licenseLastValidatedAt: input.validatedAt && toDate(input.validatedAt),
      },
    });
    if (count === 0) throw new OrganizationNotFoundError();
  }

  async clearLicense(input: { organizationId: string }): Promise<void> {
    const { count } = await this.database.organization.updateMany({
      where: { id: input.organizationId },
      data: { license: null, licenseExpiresAt: null, licenseLastValidatedAt: null },
    });
    if (count === 0) throw new OrganizationNotFoundError();
  }

  async findFirstAdministratorEmail(organizationId: string): Promise<string | null> {
    const administrator = await this.database.organizationUser.findFirst({
      where: { organizationId, role: "ADMIN", disabledAt: null },
      orderBy: { createdAt: "asc" },
      select: { user: { select: { email: true } } },
    });
    return administrator?.user.email ?? null;
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
  }): Promise<EnsuredPersonalTeam> {
    try {
      return await this.database.$transaction(async (transaction) => {
        const existing = await this.tryFindPersonalTeam(transaction, input.workspace);
        if (existing) return existing;

        const revived = await this.tryReactivateWorkspace(transaction, input.workspace);
        if (revived) return { kind: "pending", team: revived };

        const team = await this.createPersonalTeam(transaction, input.workspace, input.resources);
        return { kind: "pending", team };
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const winner = await this.tryFindPersonalTeam(this.database, input.workspace);
      if (!winner) throw error;
      return winner;
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

  async findProjectIds(organizationId: string): Promise<string[]> {
    const rows = await this.database.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async findProjectNames(projectIds: readonly string[]): Promise<{ id: string; name: string }[]> {
    if (projectIds.length === 0) return [];
    return this.database.project.findMany({
      where: { id: { in: [...projectIds] } },
      select: { id: true, name: true },
    });
  }

  async findProjects(input: {
    organizationId: string;
    hiddenKinds: readonly string[];
    teamId?: string;
    limit?: number;
  }): Promise<OrganizationTeamProject[]> {
    return this.database.project.findMany({
      where: {
        archivedAt: null,
        kind: { notIn: [...input.hiddenKinds] },
        team: { organizationId: input.organizationId },
        ...(input.teamId ? { teamId: input.teamId } : {}),
      },
      select: { id: true, name: true, slug: true, teamId: true, createdAt: true, updatedAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit,
    });
  }

  async appendPersonalWorkspaceFeaturesAudit(input: {
    projectId: string;
    callerUserId: string;
    organizationId: string | null;
    action: string;
    before: PersonalFeatures;
    after: PersonalFeatures;
  }): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await this.audit.append({
        transaction,
        fact: {
          tenantId: input.organizationId ?? input.projectId,
          userId: input.callerUserId,
          projectId: input.projectId,
          organizationId: input.organizationId,
          action: input.action,
          targetKind: "project",
          targetId: input.projectId,
          before: input.before,
          after: input.after,
        },
      });
    });
  }

  /** Project creates the personal project on organization's fact (Round 54); never here. */
  private async createPersonalTeam(
    transaction: Prisma.TransactionClient,
    input: {
      userId: string;
      organizationId: string;
      displayName?: string | null;
      displayEmail?: string | null;
    },
    resources: PersonalWorkspaceResourceIds,
  ): Promise<PersonalWorkspace["team"]> {
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
    await transaction.teamUser.create({
      data: { userId: input.userId, teamId: team.id, role: "ADMIN" },
    });
    return mapPersonalTeam(team);
  }

  private async tryReactivateWorkspace(
    transaction: Prisma.TransactionClient,
    input: { userId: string; organizationId: string },
  ): Promise<PersonalWorkspace["team"] | null> {
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
    // Project revives the personal project on organization's fact; pending until it has.
    const revived = await transaction.team.update({
      where: { id: archived.id },
      data: { archivedAt: null },
    });
    return mapPersonalTeam(revived);
  }

  private async tryFindWorkspace(
    client: Client,
    input: { userId: string; organizationId: string },
  ): Promise<PersonalWorkspace | null> {
    const found = await this.tryFindPersonalTeam(client, input);
    return found?.kind === "ready" ? found.workspace : null;
  }

  private async tryFindPersonalTeam(
    client: Client,
    input: { userId: string; organizationId: string },
  ): Promise<EnsuredPersonalTeam | null> {
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
    if (!team) return null;
    const project = team.projects[0];
    if (!project) return { kind: "pending", team: mapPersonalTeam(team) };
    return { kind: "ready", workspace: mapPersonalWorkspace(team, project) };
  }
}
function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function mapPersonalTeam(
  team: Pick<Team, "id" | "name" | "slug" | "createdAt">,
): PersonalWorkspace["team"] {
  return { id: team.id, name: team.name, slug: team.slug, createdAtMs: team.createdAt.getTime() };
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
    team: mapPersonalTeam(team),
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      apiKey: project.apiKey,
      createdAtMs: project.createdAt.getTime(),
    },
  };
}
