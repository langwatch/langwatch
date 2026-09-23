import {
  type GuidedOnboardingRecord,
  parseGuidedOnboardingState,
  parseOnboardingVariant,
} from "@langwatch/onboarding-contract";
import {
  type JoinRequestJoining,
  OrganizationHasNoTeamError,
  OrganizationNotFoundError,
  PersonalProjectNotFoundError,
  type OrganizationBillingProfile,
  type PersonalFeatures,
  type PersonalWorkspace,
  type OrganizationUsageCount,
} from "@langwatch/organization-contract";
import { nowInstant, toDate } from "@langwatch/time";

import {
  OrganizationRepository,
  type PersonalWorkspaceFeatureProject,
  type PersonalWorkspaceResourceIds,
  type StoredOrganizationSettings,
} from "../organization.repository.ts";
import type {
  MemoryOrganizationDatabase,
  MemoryOrganizationRow,
  MemoryTeamRow,
} from "./memory.organization.database.ts";

/** In-memory `OrganizationRepository`, for tests and a memory-backed boot. */
export class MemoryOrganizationRepository extends OrganizationRepository {
  private constructor(private readonly memory: MemoryOrganizationDatabase) {
    super();
  }

  static create(options: { memory: MemoryOrganizationDatabase }): MemoryOrganizationRepository {
    return new MemoryOrganizationRepository(options.memory);
  }

  async findAllIds(): Promise<string[]> {
    return [...this.memory.organizations.keys()];
  }

  /** The memory rows carry no legacy single sign-on column, so no provider is named here. */
  async countUsage({
    organizationIds,
  }: {
    organizationIds: readonly string[];
  }): Promise<OrganizationUsageCount> {
    const joined = this.memory.organizationUsers
      .filter((row) => organizationIds.includes(row.organizationId))
      .map((row) => row.createdAt.getTime())
      .toSorted((left, right) => left - right);
    const second = joined[1];
    return {
      members: joined.length,
      ssoProviders: [],
      ...(second === undefined ? {} : { secondMemberJoinedAt: second }),
    };
  }

  async findStoredSettings(organizationId: string): Promise<StoredOrganizationSettings | null> {
    const organization = this.memory.organizations.get(organizationId);
    return organization ? { ...organization } : null;
  }

  async getJoinSetting({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<JoinRequestJoining> {
    const organization = this.requireOrganization(organizationId);

    return {
      domainJoin: organization.domainJoin ?? "request",
      joinDomains: [...(organization.joinDomains ?? [])],
    };
  }

  async saveJoinSetting({
    organizationId,
    setting,
  }: {
    organizationId: string;
    setting: JoinRequestJoining;
  }): Promise<void> {
    const organization = this.requireOrganization(organizationId);
    organization.domainJoin = setting.domainJoin;
    organization.joinDomains = [...setting.joinDomains];
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
      ...(organization.signupData ?? {}),
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
    if (input.s3Endpoint !== undefined) organization.s3Endpoint = input.s3Endpoint;
    if (input.s3AccessKeyId !== undefined) organization.s3AccessKeyId = input.s3AccessKeyId;
    if (input.s3SecretAccessKey !== undefined) {
      organization.s3SecretAccessKey = input.s3SecretAccessKey;
    }
    if (input.s3Bucket !== undefined) organization.s3Bucket = input.s3Bucket || null;
    organization.updatedAt = toDate(nowInstant());
  }

  async getOldestTeamId(organizationId: string): Promise<string> {
    const oldest = this.teamsOf(organizationId).toSorted(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )[0];
    if (!oldest) throw new OrganizationHasNoTeamError(organizationId);
    return oldest.id;
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

  async claimBillingCustomerId(input: {
    organizationId: string;
    billingCustomerId: string;
  }): Promise<boolean> {
    const organization = this.memory.organizations.get(input.organizationId);
    if (!organization || organization.stripeCustomerId) return false;
    organization.stripeCustomerId = input.billingCustomerId;
    return true;
  }

  async tryFindPersonalWorkspace(input: {
    userId: string;
    organizationId: string;
  }): Promise<PersonalWorkspace | null> {
    return this.findWorkspace(input);
  }

  async ensurePersonalWorkspace(input: {
    workspace: {
      userId: string;
      organizationId: string;
      displayName?: string | null;
      displayEmail?: string | null;
    };
    resources: PersonalWorkspaceResourceIds;
  }): Promise<{ workspace: PersonalWorkspace; created: boolean }> {
    const existing = this.findWorkspace(input.workspace);
    if (existing) return { workspace: existing, created: false };

    const displayLabel =
      input.workspace.displayName?.trim() || input.workspace.displayEmail?.split("@")[0] || "user";
    const now = toDate(nowInstant());
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
    this.memory.projects.set(input.resources.projectId, {
      id: input.resources.projectId,
      name: "Personal Workspace",
      slug: input.resources.projectSlug,
      apiKey: input.resources.projectApiKey,
      teamId: team.id,
      isPersonal: true,
      ownerUserId: input.workspace.userId,
      organizationId: input.workspace.organizationId,
      archivedAt: null,
      createdAt: now,
      personalFeatures: null,
    });
    this.memory.organizationUsers.push({
      userId: input.workspace.userId,
      organizationId: input.workspace.organizationId,
      role: "MEMBER",
      disabledAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const created = this.findWorkspace(input.workspace);
    if (!created) throw new Error("personal workspace vanished after being written");
    return { workspace: created, created: true };
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

  async setPersonalWorkspaceFeaturesWithAudit(input: {
    projectId: string;
    callerUserId: string;
    organizationId: string | null;
    action: string;
    before: PersonalFeatures;
    after: PersonalFeatures;
  }): Promise<void> {
    const project = this.memory.projects.get(input.projectId);
    if (!project) throw new PersonalProjectNotFoundError(input.projectId);
    project.personalFeatures = input.after;
  }

  private teamsOf(organizationId: string): MemoryTeamRow[] {
    return [...this.memory.teams.values()].filter((team) => team.organizationId === organizationId);
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
}
