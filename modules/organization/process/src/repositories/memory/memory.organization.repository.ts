import {
  type GuidedOnboardingRecord,
  parseGuidedOnboardingState,
  parseOnboardingVariant,
} from "@langwatch/onboarding-contract";
import {
  type OrganizationJoinSetting,
  OrganizationHasNoTeamError,
  OrganizationNotFoundError,
  PersonalProjectNotFoundError,
  TeamNotFoundError,
  type OrganizationBillingProfile,
  type OrganizationWithAdministrators,
  type PersonalFeatures,
  type PersonalWorkspace,
  type OrganizationIdPage,
  type OrganizationIdPageInput,
  type OrganizationUsageCount,
  type PricingModel,
  type SignInSecurityPolicy,
  type OrganizationCurrency,
} from "@langwatch/organization-contract";
import { nowInstant, Temporal, toDate, type Instant } from "@langwatch/time";

import {
  OrganizationRepository,
  type PersonalWorkspaceFeatureProject,
  type PersonalWorkspaceResourceIds,
  type EnsuredPersonalTeam,
  type StoredOrganizationSettings,
  type OrganizationTeamProject,
} from "../organization.repository.ts";
import type {
  MemoryOrganizationDatabase,
  MemoryOrganizationRow,
  MemoryTeamRow,
} from "./memory.organization.database.ts";

/** In-memory `OrganizationRepository`, for tests and a memory-backed boot. */
const BYTES_PER_MEBIBYTE = 1024 * 1024;

/** An absent column reads as no rule, so a row seeded without one asks nothing of anybody. */
const signInSecurityPolicyOf = (organization: MemoryOrganizationRow): SignInSecurityPolicy => ({
  lockoutAfterFailedAttempts: organization.lockoutAfterFailedAttempts ?? 0,
  lockoutMinutes: organization.lockoutMinutes ?? 30,
  sessionIdleTimeoutMinutes: organization.sessionIdleTimeoutMinutes ?? 0,
  sessionMaxLifetimeMinutes: organization.sessionMaxLifetimeMinutes ?? 0,
});

export class MemoryOrganizationRepository extends OrganizationRepository {
  private constructor(private readonly memory: MemoryOrganizationDatabase) {
    super();
  }

  static create(options: { memory: MemoryOrganizationDatabase }): MemoryOrganizationRepository {
    return new MemoryOrganizationRepository(options.memory);
  }

  async listAllIds({ after, limit }: OrganizationIdPageInput = {}): Promise<OrganizationIdPage> {
    const ids = [...this.memory.organizations.keys()]
      .filter((id) => after === undefined || id > after)
      .toSorted();
    if (limit === undefined || ids.length <= limit) return { ids, next: null };
    const page = ids.slice(0, limit);
    return { ids: page, next: page[page.length - 1] ?? null };
  }

  /** The memory rows carry no legacy single sign-on column, so no provider is named here. */
  async countUsage({
    organizationIds,
  }: {
    organizationIds: readonly string[];
  }): Promise<OrganizationUsageCount> {
    const joined = this.memory.organizationUsers
      .filter((row) => organizationIds.includes(row.organizationId))
      .map((row) => row.createdAt.epochMilliseconds)
      .toSorted((left, right) => left - right);
    const second = joined[1];
    const teams = [...this.memory.teams.values()].filter((team) =>
      organizationIds.includes(team.organizationId),
    );
    return {
      members: joined.length,
      teams: teams.length,
      ssoProviders: [],
      ...(second === undefined ? {} : { secondMemberJoinedAt: second }),
    };
  }

  async findStoredSettings(organizationId: string): Promise<StoredOrganizationSettings | null> {
    const organization = this.memory.organizations.get(organizationId);
    if (!organization) return null;

    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      supportContact: organization.supportContact,
      presenceEnabled: organization.presenceEnabled,
      traceSharingEnabled: organization.traceSharingEnabled,
      primaryIntent: organization.primaryIntent,
      s3Endpoint: organization.s3Endpoint,
      s3AccessKeyId: organization.s3AccessKeyId,
      s3Bucket: organization.s3Bucket,
      createdAt: toDate(organization.createdAt),
      updatedAt: toDate(organization.updatedAt),
    };
  }

  async hasStoredS3Secret(organizationId: string): Promise<boolean> {
    return !!this.memory.organizations.get(organizationId)?.s3SecretAccessKey;
  }

  async getJoinSetting({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationJoinSetting> {
    const organization = this.requireOrganization(organizationId);

    return {
      domainJoin: organization.domainJoin ?? "request",
      joinDomains: [...(organization.joinDomains ?? [])],
      joinerRole: organization.joinerRole ?? "MEMBER",
    };
  }

  async findBySsoDomain({
    domain,
  }: {
    domain: string;
  }): Promise<{ id: string; name: string; ssoProvider: string | null } | null> {
    const organization = [...this.memory.organizations.values()].find(
      (candidate) => candidate.ssoDomain === domain,
    );
    if (!organization) return null;
    return {
      id: organization.id,
      name: organization.name,
      ssoProvider: organization.ssoProvider ?? null,
    };
  }

  async getSessionPolicy({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ maxSessionDurationDays: number }> {
    const organization = this.memory.organizations.get(organizationId);
    return { maxSessionDurationDays: organization?.maxSessionDurationDays ?? 0 };
  }

  async saveSessionPolicy({
    organizationId,
    maxSessionDurationDays,
  }: {
    organizationId: string;
    maxSessionDurationDays: number;
  }): Promise<void> {
    this.requireOrganization(organizationId).maxSessionDurationDays = maxSessionDurationDays;
  }

  async getSignInSecurityPolicy({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SignInSecurityPolicy> {
    return signInSecurityPolicyOf(this.requireOrganization(organizationId));
  }

  async updateSignInSecurityPolicy({
    organizationId,
    policy,
  }: {
    organizationId: string;
    policy: SignInSecurityPolicy;
  }): Promise<void> {
    Object.assign(this.requireOrganization(organizationId), policy);
  }

  async findSignInSecurityPoliciesForUser({
    userId,
  }: {
    userId: string;
  }): Promise<SignInSecurityPolicy[]> {
    return this.memory.organizationUsers
      .filter((member) => member.userId === userId && member.disabledAt === null)
      .flatMap((member) => {
        const organization = this.memory.organizations.get(member.organizationId);
        return organization ? [signInSecurityPolicyOf(organization)] : [];
      });
  }

  async findConfiguredSignInSecurityPolicies(): Promise<SignInSecurityPolicy[]> {
    return [...this.memory.organizations.values()]
      .map(signInSecurityPolicyOf)
      .filter(
        (policy) =>
          policy.lockoutAfterFailedAttempts > 0 ||
          policy.sessionIdleTimeoutMinutes > 0 ||
          policy.sessionMaxLifetimeMinutes > 0,
      );
  }

  async getPricing({ organizationId }: { organizationId: string }): Promise<{
    pricingModel: PricingModel | null;
    currency: "USD" | "EUR";
  }> {
    const organization = this.memory.organizations.get(organizationId);
    return {
      pricingModel: organization ? (organization.pricingModel ?? "SEAT_EVENT") : null,
      currency: organization ? (organization.currency ?? "USD") : "EUR",
    };
  }

  async getDatasetLimits({ organizationId }: { organizationId: string }): Promise<{
    attachmentMaxBytes: number | null;
  }> {
    const megabytes = this.memory.organizations.get(organizationId)?.datasetAttachmentMaxMb ?? null;
    return { attachmentMaxBytes: megabytes === null ? null : megabytes * BYTES_PER_MEBIBYTE };
  }

  async isInstantEvalsOptedIn({ organizationId }: { organizationId: string }): Promise<boolean> {
    return !!this.memory.organizations.get(organizationId)?.instantEvalsEnabledAt;
  }

  async recordInstantEvalsOptIn(input: {
    organizationId: string;
    userId: string;
    at: Instant;
  }): Promise<void> {
    const organization = this.memory.organizations.get(input.organizationId);
    if (!organization || organization.instantEvalsEnabledAt) return;
    organization.instantEvalsEnabledAt = input.at;
    organization.instantEvalsEnabledByUserId = input.userId;
  }

  async saveJoinSetting({
    organizationId,
    setting,
  }: {
    organizationId: string;
    setting: OrganizationJoinSetting;
  }): Promise<void> {
    const organization = this.requireOrganization(organizationId);
    organization.domainJoin = setting.domainJoin;
    organization.joinDomains = [...setting.joinDomains];
    organization.joinerRole = setting.joinerRole;
  }

  async getGuidedOnboarding({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<GuidedOnboardingRecord> {
    const signupData = this.requireOrganization(organizationId).signupData;

    return {
      state: parseGuidedOnboardingState(signupData),
      variant: parseOnboardingVariant(signupData),
    };
  }

  async saveGuidedOnboarding({
    organizationId,
    record,
  }: {
    organizationId: string;
    record: GuidedOnboardingRecord;
  }): Promise<GuidedOnboardingRecord> {
    const organization = this.requireOrganization(organizationId);
    organization.signupData = {
      ...organization.signupData,
      guidedOnboarding: record.state,
      onboardingVariant: record.variant,
    };

    return record;
  }

  private requireOrganization(organizationId: string): MemoryOrganizationRow {
    const organization = this.memory.organizations.get(organizationId);
    if (!organization) throw new OrganizationNotFoundError();

    return organization;
  }

  async updateSettings(input: {
    organizationId: string;
    name?: string;
    supportContact?: string | null;
    presenceEnabled?: boolean;
    traceSharingEnabled?: boolean;
    primaryIntent?: StoredOrganizationSettings["primaryIntent"];
    s3Endpoint?: string | null;
    s3AccessKeyId?: string | null;
    s3SecretAccessKey?: string | null;
    s3Bucket?: string | null;
  }): Promise<void> {
    const organization = this.memory.organizations.get(input.organizationId);
    if (!organization) throw new OrganizationNotFoundError();
    if (input.name !== undefined) organization.name = input.name;
    if (input.supportContact !== undefined) {
      organization.supportContact = input.supportContact?.trim() || null;
    }
    if (input.presenceEnabled !== undefined) organization.presenceEnabled = input.presenceEnabled;
    if (input.traceSharingEnabled !== undefined) {
      organization.traceSharingEnabled = input.traceSharingEnabled;
    }
    if (input.primaryIntent !== undefined) organization.primaryIntent = input.primaryIntent;
    if (input.s3Endpoint !== undefined) organization.s3Endpoint = input.s3Endpoint || null;
    if (input.s3AccessKeyId !== undefined) organization.s3AccessKeyId = input.s3AccessKeyId || null;
    if (input.s3SecretAccessKey !== undefined) {
      organization.s3SecretAccessKey = input.s3SecretAccessKey || null;
    }
    if (input.s3Bucket !== undefined) organization.s3Bucket = input.s3Bucket || null;
    organization.updatedAt = nowInstant();
  }

  async getOldestTeamId(organizationId: string): Promise<string> {
    const oldest = this.teamsOf(organizationId).toSorted(
      (a, b) => a.createdAt.epochMilliseconds - b.createdAt.epochMilliseconds,
    )[0];
    if (!oldest) throw new OrganizationHasNoTeamError(organizationId);
    return oldest.id;
  }

  async getWithAdministrators(organizationId: string): Promise<OrganizationWithAdministrators> {
    const organization = this.memory.organizations.get(organizationId);
    if (!organization) throw new OrganizationNotFoundError();
    const administrators = this.memory.organizationUsers
      .filter((member) => member.organizationId === organizationId && member.role === "ADMIN")
      .flatMap((member) => {
        const user = this.memory.users.get(member.userId);
        return user ? [{ userId: user.id, name: user.name, email: user.email }] : [];
      });
    return {
      id: organization.id,
      name: organization.name,
      sentPlanLimitAlert: organization.sentPlanLimitAlert ?? null,
      administrators,
    };
  }

  async updateSentPlanLimitAlert(input: {
    organizationId: string;
    sentAt: Instant;
  }): Promise<void> {
    const organization = this.memory.organizations.get(input.organizationId);
    if (!organization) throw new OrganizationNotFoundError();
    organization.sentPlanLimitAlert = input.sentAt;
  }

  async updateCurrency(input: {
    organizationId: string;
    currency: OrganizationCurrency;
  }): Promise<void> {
    const organization = this.memory.organizations.get(input.organizationId);
    if (!organization) throw new OrganizationNotFoundError();
    organization.currency = input.currency;
  }

  async updatePricingModel(input: {
    organizationId: string;
    pricingModel: PricingModel;
  }): Promise<void> {
    const organization = this.memory.organizations.get(input.organizationId);
    if (!organization) throw new OrganizationNotFoundError();
    organization.pricingModel = input.pricingModel;
  }

  async findConnectServicesDisabled(organizationId: string): Promise<string[]> {
    return [...(this.memory.organizations.get(organizationId)?.connectServicesDisabled ?? [])];
  }

  async updateConnectServicesDisabled(input: {
    organizationId: string;
    servicesDisabled: readonly string[];
  }): Promise<void> {
    const organization = this.memory.organizations.get(input.organizationId);
    if (!organization) throw new OrganizationNotFoundError();
    organization.connectServicesDisabled = [...input.servicesDisabled];
  }

  async updateConnectSyncOutcome(input: {
    organizationId: string;
    at: Instant;
    error: string | null;
  }): Promise<void> {
    const organization = this.memory.organizations.get(input.organizationId);
    if (!organization) throw new OrganizationNotFoundError();
    if (!input.error) organization.connectLastSyncAt = input.at;
    organization.connectLastSyncError = input.error;
  }

  async setLicense(input: {
    organizationId: string;
    licenseKey: string;
    expiresAt: Instant;
    validatedAt: Instant | null;
  }): Promise<void> {
    const organization = this.memory.organizations.get(input.organizationId);
    if (!organization) throw new OrganizationNotFoundError();
    organization.license = input.licenseKey;
    organization.licenseExpiresAt = input.expiresAt;
    organization.licenseLastValidatedAt = input.validatedAt;
  }

  async clearLicense(input: { organizationId: string }): Promise<void> {
    const organization = this.memory.organizations.get(input.organizationId);
    if (!organization) throw new OrganizationNotFoundError();
    organization.license = null;
    organization.licenseExpiresAt = null;
    organization.licenseLastValidatedAt = null;
  }

  async findFirstAdministratorEmail(organizationId: string): Promise<string | null> {
    const [first] = this.memory.organizationUsers
      .filter(
        (member) =>
          member.organizationId === organizationId &&
          member.role === "ADMIN" &&
          member.disabledAt === null,
      )
      .toSorted((a, b) => Temporal.Instant.compare(a.createdAt, b.createdAt));
    return (first && this.memory.users.get(first.userId)?.email) ?? null;
  }

  async getBillingProfile(organizationId: string): Promise<OrganizationBillingProfile> {
    const organization = this.memory.organizations.get(organizationId);
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
    const workspace = this.findWorkspace(input);
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
    const existing = this.findPersonalTeam(input.workspace);
    if (existing) return existing;

    const displayLabel =
      input.workspace.displayName?.trim() || input.workspace.displayEmail?.split("@")[0] || "user";
    const now = nowInstant();
    const team: MemoryTeamRow = {
      id: input.resources.teamId,
      name: `${displayLabel}'s Workspace`,
      slug: input.resources.teamSlug,
      organizationId: input.workspace.organizationId,
      isPersonal: true,
      ownerUserId: input.workspace.userId,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.memory.teams.set(team.id, team);
    const alreadyMember = this.memory.organizationUsers.some(
      (row) =>
        row.userId === input.workspace.userId &&
        row.organizationId === input.workspace.organizationId,
    );
    if (!alreadyMember) {
      this.memory.organizationUsers.push({
        userId: input.workspace.userId,
        organizationId: input.workspace.organizationId,
        role: "MEMBER",
        disabledAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      kind: "pending",
      team: { id: team.id, name: team.name, slug: team.slug, createdAtMs: now.epochMilliseconds },
    };
  }

  async getPersonalWorkspaceFeatureProject(
    projectId: string,
  ): Promise<PersonalWorkspaceFeatureProject> {
    const project = this.memory.projects.get(projectId);
    if (!project) throw new PersonalProjectNotFoundError(projectId);
    return {
      id: project.id,
      isPersonal: project.isPersonal,
      ownerUserId: project.ownerUserId,
      organizationId: project.organizationId,
      personalFeatures: project.personalFeatures,
    };
  }

  async findProjectIds(organizationId: string): Promise<string[]> {
    return [...this.memory.projects.values()]
      .filter((project) => project.organizationId === organizationId)
      .map((project) => project.id);
  }

  async findProjectNames(projectIds: readonly string[]): Promise<{ id: string; name: string }[]> {
    return projectIds.flatMap((id) => {
      const project = this.memory.projects.get(id);
      return project ? [{ id: project.id, name: project.name }] : [];
    });
  }

  // shortcut: memory rows carry no project kind, so no governance project is excluded here.
  async findProjects(input: {
    organizationId: string;
    teamId?: string;
    limit?: number;
  }): Promise<OrganizationTeamProject[]> {
    return [...this.memory.projects.values()]
      .filter(
        (project) =>
          project.organizationId === input.organizationId &&
          project.archivedAt === null &&
          (input.teamId === undefined || project.teamId === input.teamId),
      )
      .toSorted((a, b) => Temporal.Instant.compare(b.createdAt, a.createdAt))
      .slice(0, input.limit)
      .map((project) => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
        teamId: project.teamId,
        createdAt: toDate(project.createdAt),
        updatedAt: toDate(project.updatedAt),
      }));
  }

  async appendPersonalWorkspaceFeaturesAudit(input: {
    projectId: string;
    callerUserId: string;
    organizationId: string | null;
    action: string;
    before: PersonalFeatures;
    after: PersonalFeatures;
  }): Promise<void> {
    // No audit store in memory; the switches are project's, set on organization's fact.
    if (!this.memory.projects.has(input.projectId)) {
      throw new PersonalProjectNotFoundError(input.projectId);
    }
  }

  private teamsOf(organizationId: string): MemoryTeamRow[] {
    return [...this.memory.teams.values()].filter((team) => team.organizationId === organizationId);
  }

  /** Pending while the personal team has no project: project creates it on organization's fact. */
  private findPersonalTeam(input: {
    userId: string;
    organizationId: string;
  }): EnsuredPersonalTeam | null {
    const workspace = this.findWorkspace(input);
    if (workspace) return { kind: "ready", workspace };
    const team = this.teamsOf(input.organizationId).find(
      (candidate) =>
        candidate.isPersonal &&
        candidate.ownerUserId === input.userId &&
        candidate.archivedAt === null,
    );
    if (!team) return null;
    return {
      kind: "pending",
      team: {
        id: team.id,
        name: team.name,
        slug: team.slug,
        createdAtMs: team.createdAt.epochMilliseconds,
      },
    };
  }

  private findWorkspace(input: {
    userId: string;
    organizationId: string;
  }): PersonalWorkspace | null {
    const team = this.teamsOf(input.organizationId).find(
      (candidate) =>
        candidate.isPersonal &&
        candidate.ownerUserId === input.userId &&
        candidate.archivedAt === null,
    );
    if (!team) return null;
    const project = [...this.memory.projects.values()].find(
      (candidate) => candidate.teamId === team.id && candidate.isPersonal,
    );
    if (!project) return null;
    return {
      team: {
        id: team.id,
        name: team.name,
        slug: team.slug,
        createdAtMs: team.createdAt.epochMilliseconds,
      },
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
        apiKey: project.apiKey,
        createdAtMs: project.createdAt.epochMilliseconds,
      },
    };
  }
}
