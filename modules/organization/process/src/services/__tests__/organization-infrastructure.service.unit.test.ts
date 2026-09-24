import { createApiFixture } from "@langwatch/api-fixture";
import {
  AuthzGrantsService,
  type AuthzApi,
  AuthzLedgerUnavailableError,
  type AuthzAttachBindingsInput,
  type AuthzAttachBindingsOutput,
  type AuthzAccessBinding,
  type AuthzRevokeBindingsInput,
  type AuthzRevokeBindingsWhereInput,
} from "@langwatch/authz-contract";
import type { GuidedOnboardingRecord } from "@langwatch/onboarding-contract";
import {
  OrganizationHasNoTeamError,
  OrganizationNotFoundError,
  PersonalTeamProtectedError,
  TeamMembershipNotFoundError,
  TeamNotFoundError,
  UserNotInOrganizationError,
  type OrganizationBillingProfile,
  type OrganizationTeam,
  type OrganizationTeamPage,
  type PersonalFeatures,
  type PersonalWorkspace,
} from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import type {
  GroupIdentity,
  PersonalWorkspaceIdentity,
  TeamIdentity,
} from "../../app/organization.members.ts";
import type * as groupRepositoryModule from "../../repositories/group.repository.ts";
import {
  OrganizationRepository,
  type PersonalWorkspaceFeatureProject,
  type PersonalWorkspaceResourceIds,
  type StoredOrganizationSettings,
} from "../../repositories/organization.repository.ts";
import { TeamRepository } from "../../repositories/team.repository.ts";
import { OrganizationService } from "../organization.service.ts";

class StubRepository extends OrganizationRepository {
  async findAllIds(): Promise<string[]> {
    return [];
  }

  async countUsage(): Promise<{ members: number; ssoProviders: string[] }> {
    return { members: 0, ssoProviders: [] };
  }

  guidedOnboarding: GuidedOnboardingRecord = { state: { paths: [], donePaths: [] }, variant: null };
  storedSettings: StoredOrganizationSettings | null = null;

  async getJoinSetting(): Promise<{ domainJoin: "request"; joinDomains: string[] }> {
    return { domainJoin: "request", joinDomains: [] };
  }

  async saveJoinSetting(): Promise<void> {}

  async getGuidedOnboarding(): Promise<GuidedOnboardingRecord> {
    return this.guidedOnboarding;
  }

  async saveGuidedOnboarding({
    record,
  }: {
    organizationId: string;
    record: GuidedOnboardingRecord;
  }): Promise<GuidedOnboardingRecord> {
    this.guidedOnboarding = record;

    return record;
  }

  settingsUpdate: Record<string, unknown> | null = null;
  constructor(
    private readonly teamId: string | null,
    private billingProfile: OrganizationBillingProfile | null = {
      id: "org",
      name: "Acme",
      billingCustomerId: null,
    },
  ) {
    super();
  }

  async getOldestTeamId(organizationId: string): Promise<string> {
    if (!this.teamId) throw new OrganizationHasNoTeamError(organizationId);
    return this.teamId;
  }

  findStoredSettings(): Promise<StoredOrganizationSettings | null> {
    return Promise.resolve(this.storedSettings);
  }

  updateSettings(input: Record<string, unknown>): Promise<void> {
    this.settingsUpdate = input;
    return Promise.resolve();
  }

  async getBillingProfile(): Promise<OrganizationBillingProfile> {
    if (!this.billingProfile) throw new OrganizationNotFoundError();
    return this.billingProfile;
  }

  async claimBillingCustomerId(input: {
    organizationId: string;
    billingCustomerId: string;
  }): Promise<boolean> {
    if (!this.billingProfile || this.billingProfile.billingCustomerId) {
      return false;
    }
    this.billingProfile = {
      ...this.billingProfile,
      billingCustomerId: input.billingCustomerId,
    };
    return true;
  }

  getPersonalWorkspace(): Promise<PersonalWorkspace> {
    return Promise.reject(new TeamNotFoundError());
  }

  ensurePersonalWorkspace(): Promise<{
    workspace: PersonalWorkspace;
    created: boolean;
  }> {
    throw new Error("not used by this test");
  }

  getPersonalWorkspaceFeatureProject(): Promise<PersonalWorkspaceFeatureProject> {
    throw new Error("not used by this test");
  }

  setPersonalWorkspaceFeaturesWithAudit(_input: {
    projectId: string;
    callerUserId: string;
    organizationId: string | null;
    action: string;
    before: PersonalFeatures;
    after: PersonalFeatures;
  }): Promise<void> {
    return Promise.resolve();
  }
}

class FixedIdentities implements PersonalWorkspaceIdentity {
  create(): PersonalWorkspaceResourceIds {
    return {
      teamId: "team",
      teamSlug: "team",
      projectId: "project",
      projectSlug: "project",
      projectApiKey: "key",
      ownerBindingId: "binding",
    };
  }
}

class UnusedTeams extends TeamRepository {
  get(): Promise<OrganizationTeam> {
    throw new Error("not used by this test");
  }
  findOrganizationId(): Promise<string | null> {
    throw new Error("not used by this test");
  }
  listPage(): Promise<OrganizationTeamPage> {
    throw new Error("not used by this test");
  }
  create(): Promise<OrganizationTeam> {
    throw new Error("not used by this test");
  }
  update(): Promise<OrganizationTeam> {
    throw new Error("not used by this test");
  }
  archive(): Promise<OrganizationTeam> {
    throw new Error("not used by this test");
  }
  getOrganizationMembers = (): Promise<string[]> => {
    throw new Error("not used by this test");
  };
  memberOrganizationIds(): Promise<string[]> {
    throw new Error("not used by this test");
  }

  organizationIdsForMember(): Promise<string[]> {
    throw new Error("not used by this test");
  }
  getById(): Promise<OrganizationTeam> {
    throw new Error("not used by this test");
  }
  getBySlug(): Promise<OrganizationTeam> {
    throw new Error("not used by this test");
  }
  findActive(): Promise<OrganizationTeam[]> {
    throw new Error("not used by this test");
  }
  fenceMembershipChange(): Promise<OrganizationTeam> {
    throw new Error("not used by this test");
  }
}

class FixedTeamIdentities implements TeamIdentity {
  createTeam(): { teamId: string; slug: string } {
    return { teamId: "team", slug: "team" };
  }
  createBindingId(): string {
    return "binding";
  }
}

class RecordingGrants extends AuthzGrantsService {
  readonly attachedInputs: AuthzAttachBindingsInput[] = [];
  readonly revokedInputs: AuthzRevokeBindingsWhereInput[] = [];
  readonly revokedBindingInputs: AuthzRevokeBindingsInput[] = [];
  removed = 1;
  readonly attach = unsupported<AuthzGrantsService["attach"]>();
  readonly update = unsupported<AuthzGrantsService["update"]>();
  readonly revoke = unsupported<AuthzGrantsService["revoke"]>();
  readonly replace = unsupported<AuthzGrantsService["replace"]>();
  readonly offboard = unsupported<AuthzGrantsService["offboard"]>();
  readonly attachResourceGrant = unsupported<AuthzGrantsService["attachResourceGrant"]>();
  readonly revokeResourceGrants = unsupported<AuthzGrantsService["revokeResourceGrants"]>();
  readonly changeBindingRole = unsupported<AuthzGrantsService["changeBindingRole"]>();
  readonly offboardMember = unsupported<AuthzGrantsService["offboardMember"]>();
  readonly defineRole = unsupported<AuthzGrantsService["defineRole"]>();
  readonly deleteRole = unsupported<AuthzGrantsService["deleteRole"]>();
  readonly createBinding = unsupported<AuthzGrantsService["createBinding"]>();
  readonly updateBinding = unsupported<AuthzGrantsService["updateBinding"]>();
  readonly deleteBinding = unsupported<AuthzGrantsService["deleteBinding"]>();
  readonly applyMemberBindings = unsupported<AuthzGrantsService["applyMemberBindings"]>();
  readonly invalidateOrganization = unsupported<AuthzGrantsService["invalidateOrganization"]>();

  constructor(private readonly failure?: Error) {
    super();
  }

  attachBindings(input: AuthzAttachBindingsInput): Promise<AuthzAttachBindingsOutput> {
    if (this.failure) return Promise.reject(this.failure);
    this.attachedInputs.push(input);
    return Promise.resolve({
      attached: input.bindings.map(({ bindingId }) => bindingId),
      duplicates: [],
    });
  }

  revokeBindingsWhere(input: AuthzRevokeBindingsWhereInput): Promise<number> {
    this.revokedInputs.push(input);
    return Promise.resolve(this.removed);
  }

  revokeBindings(input: AuthzRevokeBindingsInput): Promise<void> {
    this.revokedBindingInputs.push(input);
    return Promise.resolve();
  }

  /** Unreached here: this fake's ledger holds no writer for a grant. */
  retireDirectoryGrants(): Promise<number> {
    return Promise.resolve(0);
  }

  findDirectoryCausedChanges(): Promise<[]> {
    return Promise.resolve([]);
  }
}

function unsupported<Method>(): Method {
  return (() => Promise.reject(new Error("not used by this test"))) as Method;
}

function createService(
  repository: OrganizationRepository,
  grants: AuthzGrantsService = new RecordingGrants(),
  teams: TeamRepository = new UnusedTeams(),
  teamBindings: AuthzAccessBinding[] = [
    {
      id: "binding_member",
      organizationId: "org",
      userId: "user",
      groupId: null,
      apiKeyId: null,
      role: "MEMBER",
      customRoleId: null,
      scopeType: "TEAM",
      scopeId: "team",
      createdAt: new Date(1),
      user: null,
      group: null,
      apiKey: null,
      customRole: null,
    },
    {
      id: "binding_admin",
      organizationId: "org",
      userId: "admin",
      groupId: null,
      apiKeyId: null,
      role: "ADMIN",
      customRoleId: null,
      scopeType: "TEAM",
      scopeId: "team",
      createdAt: new Date(1),
      user: null,
      group: null,
      apiKey: null,
      customRole: null,
    },
  ],
): OrganizationService {
  const authzApi = createApiFixture<AuthzApi>({
    listScopeBindings: async () => teamBindings,
    attachBindings: (input) => grants.attachBindings(input),
    revokeBindings: (input) => grants.revokeBindings(input),
    revokeBindingsWhere: (input) => grants.revokeBindingsWhere(input),
  });
  return OrganizationService.create({
    repository,
    teams,
    groups: createApiFixture<groupRepositoryModule.GroupRepository>({
      findMembersForGroups: () => Promise.resolve(new Map()),
    }),
    identities: new FixedIdentities(),
    teamIdentities: new FixedTeamIdentities(),
    groupIdentities: {} as GroupIdentity,
    authz: authzApi,
    grants: authzApi,
    settingsSecrets: { encrypt: (value: string) => value, decrypt: (value: string) => value },
  });
}

const sharedTeam: OrganizationTeam = {
  id: "team",
  name: "Shared",
  slug: "shared-team",
  organizationId: "org",
  isPersonal: false,
  ownerUserId: null,
  archivedAt: null,
  createdAt: new Date(1),
  updatedAt: new Date(1),
};

class MemoryTeams extends TeamRepository {
  team: OrganizationTeam = sharedTeam;
  member = true;
  activeMember = true;
  organizationMemberReads = 0;

  memberOrganizationIds(): Promise<string[]> {
    throw new Error("not used by this test");
  }

  organizationIdsForMember(): Promise<string[]> {
    throw new Error("not used by this test");
  }

  get(): Promise<OrganizationTeam> {
    return Promise.resolve(this.team);
  }
  findOrganizationId({ teamId }: { teamId: string }): Promise<string | null> {
    return Promise.resolve(teamId === this.team.id ? this.team.organizationId : null);
  }
  listPage(): Promise<OrganizationTeamPage> {
    return Promise.resolve({
      data: [this.team],
      pagination: { page: 1, limit: 50, total: 1 },
    });
  }
  create(input: {
    teamId: string;
    name: string;
    slug: string;
    organizationId: string;
  }): Promise<OrganizationTeam> {
    this.team = {
      ...sharedTeam,
      id: input.teamId,
      name: input.name,
      slug: input.slug,
      organizationId: input.organizationId,
    };
    return Promise.resolve(this.team);
  }
  update(input: { name?: string }): Promise<OrganizationTeam> {
    this.team = { ...this.team, name: input.name ?? this.team.name };
    return Promise.resolve(this.team);
  }
  archive(): Promise<OrganizationTeam> {
    this.team = { ...this.team, archivedAt: new Date(2) };
    return Promise.resolve(this.team);
  }
  getOrganizationMembers = (input: {
    userIds: string[];
    activeOnly?: boolean;
  }): Promise<string[]> => {
    this.organizationMemberReads += 1;
    if ((!this.member || (input.activeOnly && !this.activeMember)) && input.userIds[0]) {
      return Promise.reject(new UserNotInOrganizationError(input.userIds[0]));
    }
    return Promise.resolve(input.userIds);
  };
  getById(): Promise<OrganizationTeam> {
    return Promise.resolve(this.team);
  }
  getBySlug(input: { slug: string }): Promise<OrganizationTeam> {
    return input.slug === this.team.slug
      ? Promise.resolve(this.team)
      : Promise.reject(new TeamNotFoundError(input.slug));
  }
  findActive(): Promise<OrganizationTeam[]> {
    return Promise.resolve([this.team]);
  }
  fenceMembershipChange(input: { name?: string }): Promise<OrganizationTeam> {
    this.team = { ...this.team, name: input.name ?? this.team.name };
    return Promise.resolve(this.team);
  }
}

describe("OrganizationService", () => {
  it("answers the organization behind a team", async () => {
    const service = createService(
      new StubRepository("team"),
      new RecordingGrants(),
      new MemoryTeams(),
    );

    await expect(service.getOrganizationIdByTeamId({ teamId: "team" })).resolves.toBe("org");
  });

  it("refuses a team nothing owns with organization_not_found_for_team", async () => {
    const service = createService(
      new StubRepository("team"),
      new RecordingGrants(),
      new MemoryTeams(),
    );

    await expect(service.getOrganizationIdByTeamId({ teamId: "gone" })).rejects.toMatchObject({
      code: "organization_not_found_for_team",
    });
  });

  it("returns management settings through the canonical service", async () => {
    const repository = new StubRepository("team");
    repository.storedSettings = {
      id: "org",
      name: "Acme",
      slug: "acme",
      supportContact: null,
      presenceEnabled: true,
      traceSharingEnabled: true,
      primaryIntent: null,
      s3Endpoint: "https://storage.example.com",
      s3AccessKeyId: "key",
      s3Bucket: "bucket",
      createdAt: new Date(1),
      updatedAt: new Date(2),
    };

    // The stub's settingsSecrets is the identity function, so the decrypted
    // answer equals the stored row byte for byte.
    await expect(createService(repository).getSettings({ organizationId: "org" })).resolves.toEqual(
      repository.storedSettings,
    );
  });

  it("returns committed trace-share revocations after disabling sharing", async () => {
    const repository = new StubRepository("team");
    repository.storedSettings = {
      id: "org",
      name: "Acme",
      slug: "acme",
      supportContact: null,
      presenceEnabled: true,
      traceSharingEnabled: true,
      primaryIntent: null,
      s3Endpoint: null,
      s3AccessKeyId: null,
      s3Bucket: null,
      createdAt: new Date(1),
      updatedAt: new Date(2),
    };
    await expect(
      createService(repository).updateSettings({
        organizationId: "org",
        traceSharingEnabled: false,
      }),
    ).resolves.toEqual({ traceShareRevocationRequired: true });
    expect(repository.settingsUpdate).toEqual({
      organizationId: "org",
      traceSharingEnabled: false,
    });
  });

  it("does not request trace-share revocation for settings updates without a sharing transition", async () => {
    const repository = new StubRepository("team");

    await expect(
      createService(repository).updateSettings({ organizationId: "org", name: "Renamed" }),
    ).resolves.toEqual({ traceShareRevocationRequired: false });
    expect(repository.settingsUpdate).toEqual({ organizationId: "org", name: "Renamed" });
  });
  it("reads requested organization members with one repository call", async () => {
    const teams = new MemoryTeams();
    const members = await createService(
      new StubRepository("team"),
      new RecordingGrants(),
      teams,
    ).getOrganizationMembers({ organizationId: "org", userIds: ["user-1", "user-2"] });

    expect(members).toEqual(["user-1", "user-2"]);
    expect(teams.organizationMemberReads).toBe(1);
  });

  it("distinguishes active membership from a disabled membership", async () => {
    const teams = new MemoryTeams();
    teams.activeMember = false;
    const service = createService(new StubRepository("team"), new RecordingGrants(), teams);

    await expect(service.isMember({ organizationId: "org", userId: "user-1" })).resolves.toBe(
      false,
    );
    await expect(
      service.isMember({ organizationId: "org", userId: "user-1", includeDeactivated: true }),
    ).resolves.toBe(true);
  });

  it("returns the required oldest team", async () => {
    await expect(
      createService(new StubRepository("oldest-team")).getOldestTeamId({
        organizationId: "org",
      }),
    ).resolves.toBe("oldest-team");
  });

  it("propagates the organization-owned missing-team error", async () => {
    await expect(
      createService(new StubRepository(null)).getOldestTeamId({
        organizationId: "org",
      }),
    ).rejects.toBeInstanceOf(OrganizationHasNoTeamError);
  });

  it("returns and atomically claims the billing profile", async () => {
    const service = createService(new StubRepository("team"));
    await expect(service.getBillingProfile({ organizationId: "org" })).resolves.toMatchObject({
      billingCustomerId: null,
    });
    await expect(
      service.claimBillingCustomerId({
        organizationId: "org",
        billingCustomerId: "customer-1",
      }),
    ).resolves.toBe(true);
    await expect(service.getBillingProfile({ organizationId: "org" })).resolves.toMatchObject({
      billingCustomerId: "customer-1",
    });
  });

  it("owns team creation behind the canonical service", async () => {
    const teams = new MemoryTeams();
    await expect(
      createService(new StubRepository("team"), new RecordingGrants(), teams).createTeam({
        organizationId: "org",
        name: "Shared",
      }),
    ).resolves.toMatchObject({ id: "team", slug: "team" });
  });

  it("protects personal teams from archive and membership mutation", async () => {
    const teams = new MemoryTeams();
    teams.team = { ...sharedTeam, isPersonal: true, ownerUserId: "owner" };
    const service = createService(new StubRepository("team"), new RecordingGrants(), teams);
    await expect(
      service.archiveTeam({ organizationId: "org", teamId: "team" }),
    ).rejects.toBeInstanceOf(PersonalTeamProtectedError);
    await expect(
      service.addTeamMember({
        organizationId: "org",
        teamId: "team",
        userId: "user",
        role: "MEMBER",
        actor: { type: "user", id: "actor" },
      }),
    ).rejects.toBeInstanceOf(PersonalTeamProtectedError);
  });

  it("uses AuthZ grants for team membership writes", async () => {
    const teams = new MemoryTeams();
    const grants = new RecordingGrants();
    const service = createService(new StubRepository("team"), grants, teams);
    await service.addTeamMember({
      organizationId: "org",
      teamId: "team",
      userId: "user",
      role: "MEMBER",
      actor: { type: "user", id: "actor" },
    });
    expect(grants.attachedInputs[0]).toMatchObject({
      organizationId: "org",
      bindings: [{ principal: { userId: "user" }, scopeId: "team" }],
    });
    await service.removeTeamMember({
      organizationId: "org",
      teamId: "team",
      userId: "user",
      actor: { type: "user", id: "actor" },
    });
    expect(grants.revokedBindingInputs[0]).toMatchObject({
      organizationId: "org",
      bindingIds: ["binding_member"],
    });
  });

  it("rejects membership changes for users outside the organization", async () => {
    const teams = new MemoryTeams();
    teams.member = false;
    await expect(
      createService(new StubRepository("team"), new RecordingGrants(), teams).addTeamMember({
        organizationId: "org",
        teamId: "team",
        userId: "stranger",
        role: "VIEWER",
        actor: { type: "user", id: "actor" },
      }),
    ).rejects.toBeInstanceOf(UserNotInOrganizationError);
  });

  it("reports a missing team membership from the grants service", async () => {
    await expect(
      createService(
        new StubRepository("team"),
        new RecordingGrants(),
        new MemoryTeams(),
        [],
      ).removeTeamMember({
        organizationId: "org",
        teamId: "team",
        userId: "user",
        actor: { type: "user", id: "actor" },
      }),
    ).rejects.toBeInstanceOf(TeamMembershipNotFoundError);
  });

  it("uses the canonical AuthZ grants service for workspace ownership", async () => {
    const repository = new StubRepository("team");
    repository.ensurePersonalWorkspace = () =>
      Promise.resolve({
        workspace: {
          team: {
            id: "team",
            name: "Personal",
            slug: "personal",
            createdAtMs: 1,
          },
          project: {
            id: "project",
            name: "Personal",
            slug: "personal",
            apiKey: "key",
            createdAtMs: 1,
          },
        },
        created: false,
      });
    const grants = new RecordingGrants();

    await expect(
      createService(repository, grants).ensurePersonalWorkspace({
        userId: "user",
        organizationId: "org",
      }),
    ).resolves.toMatchObject({ created: false });
    expect(grants.attachedInputs).toEqual([
      {
        organizationId: "org",
        bindings: [
          {
            bindingId: "binding",
            principal: { userId: "user" },
            role: "ADMIN",
            customRoleId: null,
            scopeType: "TEAM",
            scopeId: "team",
          },
        ],
        actor: { type: "system", id: "system:personal-workspace" },
        source: "grants-service",
        onDuplicate: "skip",
        awaitProjection: false,
      },
    ]);
  });

  it("only tolerates the portable AuthZ unavailable error", async () => {
    const repository = new StubRepository("team");
    repository.ensurePersonalWorkspace = () =>
      Promise.resolve({
        workspace: {
          team: {
            id: "team",
            name: "Personal",
            slug: "personal",
            createdAtMs: 1,
          },
          project: {
            id: "project",
            name: "Personal",
            slug: "personal",
            apiKey: "key",
            createdAtMs: 1,
          },
        },
        created: true,
      });

    await expect(
      createService(
        repository,
        new RecordingGrants(new AuthzLedgerUnavailableError()),
      ).ensurePersonalWorkspace({
        userId: "user",
        organizationId: "org",
      }),
    ).resolves.toMatchObject({ created: true });
  });
});
