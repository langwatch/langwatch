import type {
  AuthzAccessBinding,
  AuthzGrantsService,
  AuthzService,
  AuthzTeamMemberBinding,
} from "@langwatch/authz-contract";
import {
  CannotRemoveSelfAsLastAdminError,
  TeamLastAdminRequiredError,
  TeamNotFoundError,
  type OrganizationGroup,
  type OrganizationGroupMember,
  type OrganizationTeam,
} from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";
import {
  GroupIdentityPort,
  PersonalWorkspaceIdentityPort,
  TeamIdentityPort,
  type OrganizationRepository,
} from "../../ports/organization.port";
import { GroupRepository } from "../group.repository";
import { TeamRepository } from "../team.repository";
import { OrganizationService } from "../../services/organization.service";

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

  get(): Promise<OrganizationTeam> {
    return Promise.resolve(team);
  }
  getById(): Promise<OrganizationTeam> {
    return Promise.resolve(team);
  }
  tryGetOrganizationId(): Promise<string | null> {
    return Promise.resolve(team.organizationId);
  }
  getBySlug(): Promise<OrganizationTeam> {
    return Promise.resolve(team);
  }
  list(): never {
    throw new Error("not used");
  }
  listActive(): Promise<OrganizationTeam[]> {
    return Promise.resolve([team]);
  }
  tryFindBySlug(): Promise<OrganizationTeam | null> {
    return Promise.resolve(null);
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
  getOrganizationMembers(input: { userIds: string[] }): Promise<string[]> {
    return Promise.resolve(input.userIds);
  }
  fenceMembershipChange(input: unknown): Promise<OrganizationTeam> {
    this.fenced.push(input);
    return Promise.resolve(team);
  }
}

class MemoryGroups extends GroupRepository {
  members = new Map<string, OrganizationGroupMember[]>();

  listMembersForGroups(): Promise<Map<string, OrganizationGroupMember[]>> {
    return Promise.resolve(this.members);
  }
  get(): never {
    throw new Error("not used");
  }
  list(): never {
    throw new Error("not used");
  }
  listForMember(): never {
    throw new Error("not used");
  }
  listMembers(): never {
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

class Identities extends TeamIdentityPort {
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
}) {
  const teams = new MemoryTeams();
  const groups = options?.groups ?? new MemoryGroups();
  const calls = {
    attach: vi.fn().mockResolvedValue({ attached: [], duplicates: [] }),
    change: vi.fn().mockResolvedValue(undefined),
    revoke: vi.fn().mockResolvedValue(undefined),
  };
  const authz = {
    listScopeBindings: () => Promise.resolve(options?.accessBindings ?? []),
    listTeamMemberBindings: () =>
      Promise.resolve(new Map([[team.id, options?.memberBindings ?? []]])),
    listUserCreatedRoles: () => Promise.resolve([]),
  } as unknown as AuthzService;
  const grants = {
    attachBindings: calls.attach,
    changeBindingRole: calls.change,
    revokeBindings: calls.revoke,
  } as unknown as AuthzGrantsService;
  const service = OrganizationService.create({
    repository: {} as OrganizationRepository,
    teams,
    groups,
    identities: {} as PersonalWorkspaceIdentityPort,
    teamIdentities: new Identities(),
    groupIdentities: {} as GroupIdentityPort,
    authz,
    grants,
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
      actor: { type: "user", id: "admin" },
    });
    expect(calls.change).toHaveBeenCalledWith(
      expect.objectContaining({ bindingId: "member", role: "VIEWER" }),
    );
    expect(calls.revoke).not.toHaveBeenCalled();
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

  it("refuses a bulk edit that would remove the team's last admin", async () => {
    const { service } = buildService({
      accessBindings: [accessBinding({ id: "admin", userId: "admin", role: "ADMIN" })],
    });
    await expect(
      service.updateTeamWithMembers({
        teamId: team.id,
        name: team.name,
        members: [{ userId: "admin", role: "MEMBER" }],
        actor: { type: "user", id: "admin" },
      }),
    ).rejects.toBeInstanceOf(TeamLastAdminRequiredError);
  });
});
