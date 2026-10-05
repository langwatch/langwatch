import {
  permissionsConferred,
  type AuthzAccessBinding,
  type AuthzApi,
  type AuthzTeamMemberBinding,
} from "@langwatch/authz-contract";
import {
  CannotRemoveSelfAsLastAdminError,
  TeamLastAdminRequiredError,
  TeamNotFoundError,
  type OrganizationGroup,
  type OrganizationGroupMember,
  type OrganizationTeam,
} from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { GroupIdentity } from "../../services/group-identity.service.ts";
import { OrganizationService } from "../../services/organization.service.ts";
import type { PersonalWorkspaceIdentity } from "../../services/personal-workspace-identity.service.ts";
import type { TeamIdentity } from "../../services/team-identity.service.ts";
import { GroupRepository } from "../group.repository.ts";
import type { OrganizationRepository } from "../organization.repository.ts";
import { TeamRepository } from "../team.repository.ts";

const team: OrganizationTeam = {
  id: "team_1",
  organizationId: "org_1",
  name: "Shared",
  slug: "shared",
  isPersonal: false,
  ownerUserId: null,
  archivedAt: null,
  createdAt: new Date(1),
  updatedAt: new Date(1),
};

const accessBinding = (
  input: Partial<AuthzAccessBinding> & Pick<AuthzAccessBinding, "id" | "role">,
): AuthzAccessBinding => {
  const defaults: AuthzAccessBinding = {
    id: input.id,
    organizationId: "org_1",
    userId: null,
    groupId: null,
    apiKeyId: null,
    role: input.role,
    customRoleId: null,
    scopeType: "TEAM",
    scopeId: "team_1",
    createdAt: new Date(1),
    user: null,
    group: null,
    apiKey: null,
    customRole: null,
  };
  return { ...defaults, ...input };
};

const memberBinding = (
  userId: string,
  role: AuthzTeamMemberBinding["role"],
): AuthzTeamMemberBinding => ({
  userId,
  role,
  customRoleId: null,
  createdAt: new Date(1),
  updatedAt: new Date(1),
  user: {
    id: userId,
    name: userId,
    email: `${userId}@example.com`,
    image: null,
  },
  customRole: null,
});

class MemoryTeams extends TeamRepository {
  fenced: unknown[] = [];

  memberOrganizationIds(): Promise<string[]> {
    throw new Error("not used by this test");
  }

  organizationIdsForMember(): Promise<string[]> {
    throw new Error("not used by this test");
  }

  get(): Promise<OrganizationTeam> {
    return Promise.resolve(team);
  }
  getById(): Promise<OrganizationTeam> {
    return Promise.resolve(team);
  }
  findOrganizationId(): Promise<string | null> {
    return Promise.resolve(team.organizationId);
  }
  findPersonalTeamOwners(): Promise<{ teamId: string; ownerUserId: string | null }[]> {
    throw new Error("not used by this test");
  }
  getBySlug(): Promise<OrganizationTeam> {
    return Promise.resolve(team);
  }
  listPage(): never {
    throw new Error("not used");
  }
  findActive(): Promise<OrganizationTeam[]> {
    return Promise.resolve([team]);
  }
  create(): Promise<OrganizationTeam> {
    return Promise.resolve(team);
  }
  update(): Promise<OrganizationTeam> {
    return Promise.resolve(team);
  }
  archive(): Promise<OrganizationTeam> {
    return Promise.resolve({ ...team, archivedAt: new Date(2) });
  }
  getOrganizationMembers = (input: { userIds: string[] }): Promise<string[]> => {
    return Promise.resolve(input.userIds);
  };
  async fenceMembershipChange(input: { change: () => Promise<void> }): Promise<OrganizationTeam> {
    await input.change();
    this.fenced.push(input);
    return team;
  }
}

class MemoryGroups extends GroupRepository {
  members = new Map<string, OrganizationGroupMember[]>();

  findMembersForGroups(): Promise<Map<string, OrganizationGroupMember[]>> {
    return Promise.resolve(this.members);
  }
  get(): never {
    throw new Error("not used");
  }
  listAll(): never {
    throw new Error("not used");
  }
  findForMember(): never {
    throw new Error("not used");
  }
  findMembers(): never {
    throw new Error("not used");
  }
  nextAvailableSlug(): never {
    throw new Error("not used");
  }
  create(): Promise<OrganizationGroup> {
    throw new Error("not used");
  }
  rename(): Promise<OrganizationGroup> {
    throw new Error("not used");
  }
  delete(): never {
    throw new Error("not used");
  }
  addMember(): never {
    throw new Error("not used");
  }
  removeMember(): never {
    throw new Error("not used");
  }
  applyEdits(): never {
    throw new Error("not used");
  }
}

class Identities implements TeamIdentity {
  createTeam(): { teamId: string; slug: string } {
    return { teamId: team.id, slug: team.slug };
  }
  createBindingId(): string {
    return "new_binding";
  }
}

function buildService(options?: {
  accessBindings?: AuthzAccessBinding[];
  memberBindings?: AuthzTeamMemberBinding[];
  groups?: MemoryGroups;
  /** What authz answers the caller lacks for each grant the save would write. */
  beyondCaller?: string[];
}) {
  const teams = new MemoryTeams();
  const groups = options?.groups ?? new MemoryGroups();
  const calls = {
    attach: vi.fn().mockResolvedValue({ attached: [], duplicates: [] }),
    change: vi.fn().mockResolvedValue(undefined),
    revoke: vi.fn().mockResolvedValue(undefined),
    beyondCaller: vi.fn().mockResolvedValue(options?.beyondCaller ?? []),
  };
  const authz = {
    listScopeBindings: () => Promise.resolve(options?.accessBindings ?? []),
    listTeamMemberBindings: () =>
      Promise.resolve(new Map([[team.id, options?.memberBindings ?? []]])),
    listUserCreatedRoles: () => Promise.resolve([]),
  };
  const grants = {
    attachBindings: calls.attach,
    changeBindingRole: calls.change,
    revokeBindings: calls.revoke,
    findPermissionsBeyondCaller: calls.beyondCaller,
    findRolePermissions: () => Promise.resolve([]),
  };
  const authzApi = createApiFixture<AuthzApi>({ ...authz, ...grants });
  const service = OrganizationService.create({
    repository: {} as OrganizationRepository,
    teams,
    groups,
    identities: {} as PersonalWorkspaceIdentity,
    teamIdentities: new Identities(),
    groupIdentities: {} as GroupIdentity,
    authz: authzApi,
    grants: authzApi,
    settingsSecrets: { encrypt: (value: string) => value, decrypt: (value: string) => value },
  });
  return { service, teams, calls };
}

describe("OrganizationService team membership", () => {
  it("reads role-binding-only members, collapses duplicate roles and redacts other email addresses", async () => {
    const { service } = buildService({
      memberBindings: [
        memberBinding("member", "CUSTOM"),
        memberBinding("member", "ADMIN"),
        memberBinding("caller", "MEMBER"),
      ],
    });
    const result = await service.getTeamWithMembers({
      organizationId: "org_1",
      slug: "shared",
      callerUserId: "caller",
      callerCanManage: false,
    });
    expect(result.members).toHaveLength(2);
    expect(result.members.find(({ userId }) => userId === "member")).toMatchObject({
      role: "ADMIN",
      user: { email: null },
    });
    expect(result.members.find(({ userId }) => userId === "caller")).toMatchObject({
      user: { email: "caller@example.com" },
    });
  });

  it("throws the same not-found error when a slug exists but the caller is not a member", async () => {
    const { service } = buildService({
      memberBindings: [memberBinding("someone_else", "ADMIN")],
    });
    await expect(
      service.getTeamBySlugForMember({
        organizationId: "org_1",
        slug: "shared",
        userId: "caller",
      }),
    ).rejects.toBeInstanceOf(TeamNotFoundError);
  });

  it("edits only the displayed binding and preserves an additive custom binding", async () => {
    const { service, calls } = buildService({
      accessBindings: [
        accessBinding({ id: "member", userId: "user", role: "MEMBER" }),
        accessBinding({
          id: "custom",
          userId: "user",
          role: "CUSTOM",
          customRoleId: "custom_role",
        }),
        accessBinding({ id: "admin", userId: "admin", role: "ADMIN" }),
      ],
    });
    await service.updateTeamWithMembers({
      teamId: team.id,
      name: team.name,
      members: [
        { userId: "user", role: "VIEWER" },
        { userId: "admin", role: "ADMIN" },
      ],
      caller: { type: "user", id: "admin" },
      actor: { type: "user", id: "admin" },
    });
    expect(calls.change).toHaveBeenCalledWith(
      expect.objectContaining({ bindingId: "member", role: "VIEWER" }),
    );
    expect(calls.revoke).not.toHaveBeenCalled();
  });

  /** @scenario Saving a team's members with a role above the caller is refused */
  it("asks the caller's ceiling for every add and change, and writes none when one exceeds it", async () => {
    const { service, calls } = buildService({
      accessBindings: [
        accessBinding({ id: "member", userId: "user", role: "MEMBER" }),
        accessBinding({ id: "admin", userId: "admin", role: "ADMIN" }),
      ],
      beyondCaller: ["team:manage"],
    });

    await expect(
      service.updateTeamWithMembers({
        teamId: team.id,
        name: "Renamed",
        members: [
          { userId: "newcomer", role: "MEMBER" },
          { userId: "user", role: "ADMIN" },
          { userId: "admin", role: "ADMIN" },
        ],
        caller: { type: "user", id: "lead" },
        actor: { type: "user", id: "lead" },
      }),
    ).rejects.toMatchObject({ code: "grant_exceeds_caller_permissions" });

    expect(calls.beyondCaller).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        caller: { type: "user", id: "lead" },
        scope: { type: "team", id: team.id },
        // The first grant asked is the newcomer's: what a team MEMBER role confers there.
        permissions: [
          ...permissionsConferred({ role: "MEMBER", scopeType: "TEAM", customPermissions: [] }),
        ],
      }),
    );
    expect(calls.attach).not.toHaveBeenCalled();
    expect(calls.change).not.toHaveBeenCalled();
  });

  /** @scenario Creating a staffed team is bounded by its creator, who still becomes its admin */
  it("makes the creator its admin as part of creating it, and bounds everyone else by the creator", async () => {
    const { service, teams, calls } = buildService();
    vi.spyOn(teams, "getBySlug").mockRejectedValue(new TeamNotFoundError("new"));

    await service.createTeamWithMembers({
      organizationId: "org_1",
      name: "New",
      members: [
        { userId: "lead", role: "ADMIN" },
        { userId: "newcomer", role: "MEMBER" },
      ],
      caller: { type: "user", id: "lead" },
      actor: { type: "user", id: "lead" },
    });

    // The team does not exist yet, so the creator's holdings are read at the organization.
    expect(calls.beyondCaller).toHaveBeenCalledWith({
      organizationId: "org_1",
      caller: { type: "user", id: "lead" },
      scope: { type: "organization", id: "org_1" },
      permissions: [
        ...permissionsConferred({ role: "MEMBER", scopeType: "TEAM", customPermissions: [] }),
      ],
    });
    expect(
      calls.attach.mock.calls.map(([input]) => [
        input.caller,
        input.bindings.map((b: { principal: unknown }) => b.principal),
      ]),
    ).toEqual([
      [{ type: "system" }, [{ userId: "lead" }]],
      [{ type: "user", id: "lead" }, [{ userId: "newcomer" }]],
    ]);
  });

  /** @scenario Creating a staffed team is bounded by its creator, who still becomes its admin */
  it("refuses a member above the creator before the team exists", async () => {
    const { service, teams, calls } = buildService({ beyondCaller: ["team:manage"] });
    const create = vi.spyOn(teams, "create");

    await expect(
      service.createTeamWithMembers({
        organizationId: "org_1",
        name: "New",
        members: [
          { userId: "lead", role: "MEMBER" },
          { userId: "other", role: "ADMIN" },
        ],
        caller: { type: "user", id: "lead" },
        actor: { type: "user", id: "lead" },
      }),
    ).rejects.toMatchObject({ code: "grant_exceeds_caller_permissions" });
    expect(create).not.toHaveBeenCalled();
    expect(calls.attach).not.toHaveBeenCalled();
  });

  it("refuses removal of the last effective admin before fencing or revoking", async () => {
    const { service, teams, calls } = buildService({
      accessBindings: [accessBinding({ id: "admin", userId: "admin", role: "ADMIN" })],
    });
    await expect(
      service.removeTeamMember({
        organizationId: "org_1",
        teamId: team.id,
        userId: "admin",
        actor: { type: "user", id: "admin" },
      }),
    ).rejects.toBeInstanceOf(CannotRemoveSelfAsLastAdminError);
    expect(teams.fenced).toHaveLength(0);
    expect(calls.revoke).not.toHaveBeenCalled();
  });

  /** @scenario "A team administered only through a group accepts member edits" */
  it("counts members of an admin group when applying the last-admin guard", async () => {
    const groups = new MemoryGroups();
    groups.members.set("group", [{ userId: "group_admin", name: null, email: null, image: null }]);
    const { service, teams, calls } = buildService({
      groups,
      accessBindings: [
        accessBinding({ id: "member", userId: "member", role: "MEMBER" }),
        accessBinding({ id: "group_admin", groupId: "group", role: "ADMIN" }),
      ],
    });
    await service.removeTeamMember({
      organizationId: "org_1",
      teamId: team.id,
      userId: "member",
      actor: { type: "user", id: "group_admin" },
    });
    expect(teams.fenced).toHaveLength(1);
    expect(calls.revoke).toHaveBeenCalledWith(expect.objectContaining({ bindingIds: ["member"] }));
  });

  /** @scenario "Saving the team form cannot take its last admin away" */
  it("refuses a bulk edit that would remove the team's last admin", async () => {
    const { service } = buildService({
      accessBindings: [accessBinding({ id: "admin", userId: "admin", role: "ADMIN" })],
    });
    await expect(
      service.updateTeamWithMembers({
        teamId: team.id,
        name: team.name,
        members: [{ userId: "admin", role: "MEMBER" }],
        caller: { type: "user", id: "admin" },
        actor: { type: "user", id: "admin" },
      }),
    ).rejects.toBeInstanceOf(TeamLastAdminRequiredError);
  });
});

describe("given a team a seat correction left with no team admin at all", () => {
  describe("when a member is removed from it", () => {
    /** @scenario "A team already without a team admin stays editable" */
    it("saves the change rather than refusing over an admin it never had", async () => {
      const { service, teams, calls } = buildService({
        accessBindings: [
          accessBinding({ id: "member", userId: "member", role: "MEMBER" }),
          accessBinding({ id: "other", userId: "other", role: "VIEWER" }),
        ],
      });

      await service.removeTeamMember({
        organizationId: "org_1",
        teamId: team.id,
        userId: "other",
        actor: { type: "user", id: "org_admin" },
      });

      expect(teams.fenced).toHaveLength(1);
      expect(calls.revoke).toHaveBeenCalledWith(expect.objectContaining({ bindingIds: ["other"] }));
    });
  });

  describe("when a member is promoted back to admin from the team form", () => {
    /** @scenario "A team already without a team admin stays editable" */
    it("saves the promotion that repairs the team", async () => {
      const { service, calls } = buildService({
        accessBindings: [accessBinding({ id: "member", userId: "member", role: "MEMBER" })],
      });

      await service.updateTeamWithMembers({
        teamId: team.id,
        name: team.name,
        members: [{ userId: "member", role: "ADMIN" }],
        caller: { type: "user", id: "org_admin" },
        actor: { type: "user", id: "org_admin" },
      });

      expect(calls.change).toHaveBeenCalledWith(
        expect.objectContaining({ bindingId: "member", role: "ADMIN" }),
      );
    });
  });
});

describe("given a shared team whose only admin is one of its members", () => {
  describe("when an organization admin removes them from the team's own members", () => {
    /** @scenario "Editing one team's members still refuses to remove its last admin" */
    it("refuses, naming the team, before fencing or revoking", async () => {
      const { service, teams, calls } = buildService({
        accessBindings: [
          accessBinding({ id: "admin", userId: "admin", role: "ADMIN" }),
          accessBinding({ id: "member", userId: "member", role: "MEMBER" }),
        ],
      });

      await expect(
        service.removeTeamMember({
          organizationId: "org_1",
          teamId: team.id,
          userId: "admin",
          actor: { type: "user", id: "org_admin" },
        }),
      ).rejects.toMatchObject({
        code: "team_last_admin_required",
        meta: { teamName: team.name },
      });
      expect(teams.fenced).toHaveLength(0);
      expect(calls.revoke).not.toHaveBeenCalled();
    });
  });

  describe("when the save promotes somebody else and demotes them at once", () => {
    /** @scenario "The team form hands the admin role to somebody else in one save" */
    it("goes through", async () => {
      const { service, calls } = buildService({
        accessBindings: [
          accessBinding({ id: "admin", userId: "admin", role: "ADMIN" }),
          accessBinding({ id: "member", userId: "member", role: "MEMBER" }),
        ],
      });

      await service.updateTeamWithMembers({
        teamId: team.id,
        name: team.name,
        members: [
          { userId: "admin", role: "VIEWER" },
          { userId: "member", role: "ADMIN" },
        ],
        caller: { type: "user", id: "admin" },
        actor: { type: "user", id: "admin" },
      });

      expect(calls.change).toHaveBeenCalledWith(
        expect.objectContaining({ bindingId: "member", role: "ADMIN" }),
      );
    });
  });
});

describe("given a group holds the Admin role on a team", () => {
  describe("when the group has a member and the only direct admin is demoted", () => {
    /** @scenario "A group that administers the team counts as its admin" */
    it("saves the demotion, because the group still administers the team", async () => {
      const groups = new MemoryGroups();
      groups.members.set("group", [
        { userId: "group_admin", name: null, email: null, image: null },
      ]);
      const { service, calls } = buildService({
        groups,
        accessBindings: [
          accessBinding({ id: "admin", userId: "admin", role: "ADMIN" }),
          accessBinding({ id: "group_binding", groupId: "group", role: "ADMIN" }),
        ],
      });

      await service.updateTeamWithMembers({
        teamId: team.id,
        name: team.name,
        members: [{ userId: "admin", role: "VIEWER" }],
        caller: { type: "user", id: "group_admin" },
        actor: { type: "user", id: "group_admin" },
      });

      expect(calls.change).toHaveBeenCalledWith(
        expect.objectContaining({ bindingId: "admin", role: "VIEWER" }),
      );
    });
  });

  describe("when the group has no members and the only direct admin is demoted", () => {
    /** @scenario "A group with no members does not keep a team administered" */
    it("refuses, naming the team", async () => {
      const { service } = buildService({
        groups: new MemoryGroups(),
        accessBindings: [
          accessBinding({ id: "admin", userId: "admin", role: "ADMIN" }),
          accessBinding({ id: "group_binding", groupId: "group", role: "ADMIN" }),
        ],
      });

      await expect(
        service.updateTeamWithMembers({
          teamId: team.id,
          name: team.name,
          members: [{ userId: "admin", role: "VIEWER" }],
          caller: { type: "user", id: "org_admin" },
          actor: { type: "user", id: "org_admin" },
        }),
      ).rejects.toMatchObject({
        code: "team_last_admin_required",
        meta: { teamName: team.name },
      });
    });
  });
});
