import {
  AuthzGrantsService,
  AuthzLedgerUnavailableError,
  type AuthzAttachBindingsInput,
  type AuthzAttachBindingsOutput,
  type AuthzAccessBinding,
  type AuthzRevokeBindingsInput,
  type AuthzRevokeBindingsWhereInput,
  type AuthzService,
} from "@langwatch/authz-contract";
import {
  OrganizationHasNoTeamError,
  OrganizationNotFoundError,
  PersonalTeamProtectedError,
  TeamMembershipNotFoundError,
  UserNotInOrganizationError,
  type OrganizationBillingProfile,
  type OrganizationTeam,
  type OrganizationTeamPage,
  type PersonalFeatures,
  type PersonalWorkspace,
} from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";
import {
  OrganizationRepository,
  PersonalWorkspaceIdentityPort,
  TeamIdentityPort,
  type PersonalWorkspaceFeatureProject,
  type PersonalWorkspaceResourceIds,
} from "../src/ports/organization.port";
import { TeamRepository } from "../src/repositories/team.repository";
import { OrganizationService } from "../src/services/organization.service";

class StubRepository extends OrganizationRepository {
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

  tryFindPersonalWorkspace(): Promise<PersonalWorkspace | null> {
    return Promise.resolve(null);
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

class FixedIdentities extends PersonalWorkspaceIdentityPort {
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
  list(): Promise<OrganizationTeamPage> {
    throw new Error("not used by this test");
  }
  tryFindBySlug(): Promise<OrganizationTeam | null> {
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
  getOrganizationMembers(): Promise<string[]> {
    throw new Error("not used by this test");
  }
  getById(): Promise<OrganizationTeam> {
    throw new Error("not used by this test");
  }
  getBySlug(): Promise<OrganizationTeam> {
    throw new Error("not used by this test");
  }
  listActive(): Promise<OrganizationTeam[]> {
    throw new Error("not used by this test");
  }
  fenceMembershipChange(): Promise<OrganizationTeam> {
    throw new Error("not used by this test");
  }
}

class FixedTeamIdentities extends TeamIdentityPort {
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
  readonly revokeResourceGrants =
    unsupported<AuthzGrantsService["revokeResourceGrants"]>();
  readonly changeBindingRole = unsupported<AuthzGrantsService["changeBindingRole"]>();
  readonly offboardMember = unsupported<AuthzGrantsService["offboardMember"]>();
  readonly defineRole = unsupported<AuthzGrantsService["defineRole"]>();
  readonly deleteRole = unsupported<AuthzGrantsService["deleteRole"]>();

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
  return OrganizationService.create({
    repository,
    teams,
    groups: {
      listMembersForGroups: () => Promise.resolve(new Map()),
    } as unknown as import("../src/repositories/group.repository").GroupRepository,
    identities: new FixedIdentities(),
    teamIdentities: new FixedTeamIdentities(),
    groupIdentities: {} as import("../src/ports/organization.port").GroupIdentityPort,
    authz: {
      listScopeBindings: () => Promise.resolve(teamBindings),
    } as unknown as AuthzService,
    grants,
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

  get(): Promise<OrganizationTeam> {
    return Promise.resolve(this.team);
  }
  list(): Promise<OrganizationTeamPage> {
    return Promise.resolve({
      data: [this.team],
      pagination: { page: 1, limit: 50, total: 1 },
    });
  }
  tryFindBySlug(): Promise<OrganizationTeam | null> {
    return Promise.resolve(null);
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
  getOrganizationMembers(input: { userIds: string[] }): Promise<string[]> {
    if (!this.member && input.userIds[0]) {
      return Promise.reject(new UserNotInOrganizationError(input.userIds[0]));
    }
    return Promise.resolve(input.userIds);
  }
  getById(): Promise<OrganizationTeam> {
    return Promise.resolve(this.team);
  }
  getBySlug(): Promise<OrganizationTeam> {
    return Promise.resolve(this.team);
  }
  listActive(): Promise<OrganizationTeam[]> {
    return Promise.resolve([this.team]);
  }
  fenceMembershipChange(input: { name?: string }): Promise<OrganizationTeam> {
    this.team = { ...this.team, name: input.name ?? this.team.name };
    return Promise.resolve(this.team);
  }
}

describe("OrganizationService", () => {
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
    await expect(
      service.getBillingProfile({ organizationId: "org" }),
    ).resolves.toMatchObject({ billingCustomerId: null });
    await expect(
      service.claimBillingCustomerId({
        organizationId: "org",
        billingCustomerId: "customer-1",
      }),
    ).resolves.toBe(true);
    await expect(
      service.getBillingProfile({ organizationId: "org" }),
    ).resolves.toMatchObject({ billingCustomerId: "customer-1" });
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
    const service = createService(
      new StubRepository("team"),
      new RecordingGrants(),
      teams,
    );
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
      createService(
        new StubRepository("team"),
        new RecordingGrants(),
        teams,
      ).addTeamMember({
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
