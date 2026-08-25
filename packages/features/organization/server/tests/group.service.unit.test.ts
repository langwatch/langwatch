import {
  DuplicateBindingError,
  type AuthzGrantsService,
  type AuthzService,
} from "@langwatch/authz-contract";
import {
  GroupRoleScopeError,
  UserNotInOrganizationError,
  type OrganizationGroup,
  type OrganizationTeam,
} from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";
import type {
  GroupIdentityPort,
  OrganizationRepository,
  PersonalWorkspaceIdentityPort,
  TeamIdentityPort,
} from "../src/ports/organization.port";
import type { GroupRepository } from "../src/repositories/group.repository";
import type { TeamRepository } from "../src/repositories/team.repository";
import { OrganizationService } from "../src/services/organization.service";

const group: OrganizationGroup = {
  id: "group_1",
  organizationId: "org_1",
  name: "Reviewers",
  slug: "reviewers",
  externalId: null,
  scimSource: null,
  createdAt: new Date(1),
  updatedAt: new Date(1),
};

const team: OrganizationTeam = {
  id: "team_1",
  organizationId: "org_1",
  name: "Team",
  slug: "team",
  isPersonal: false,
  ownerUserId: null,
  archivedAt: null,
  createdAt: new Date(1),
  updatedAt: new Date(1),
};

function buildService(options?: {
  customRolePermissions?: string[];
  grantsFailure?: Error;
  organizationMembersFailure?: Error;
}) {
  const groupRepository = {
    get: vi.fn().mockResolvedValue(group),
    list: vi.fn().mockResolvedValue({
      data: [{ ...group, memberCount: 0 }],
      pagination: { page: 1, limit: 50, total: 1 },
    }),
    listForMember: vi.fn().mockResolvedValue([{ ...group, memberCount: 1 }]),
    listMembers: vi.fn().mockResolvedValue([]),
    listMembersForGroups: vi.fn().mockResolvedValue(new Map()),
    nextAvailableSlug: vi.fn().mockResolvedValue("reviewers"),
    create: vi.fn().mockResolvedValue(group),
    rename: vi.fn().mockResolvedValue(group),
    delete: vi.fn().mockResolvedValue(undefined),
    addMember: vi.fn().mockResolvedValue(undefined),
    removeMember: vi.fn().mockResolvedValue(undefined),
    applyEdits: vi.fn().mockResolvedValue(undefined),
  } satisfies Record<keyof GroupRepository, unknown>;

  const teamRepository = {
    get: vi.fn().mockResolvedValue(team),
    getOrganizationMembers: options?.organizationMembersFailure
      ? vi.fn().mockRejectedValue(options.organizationMembersFailure)
      : vi.fn().mockImplementation(({ userIds }) => Promise.resolve(userIds)),
  } as unknown as TeamRepository;

  const authz = {
    tryResolveScope: vi.fn().mockImplementation((input) => {
      if (input.organizationId) {
        return Promise.resolve({ type: "organization", id: input.organizationId });
      }
      if (input.teamId) {
        return Promise.resolve({
          type: "team",
          id: input.teamId,
          organizationId: "org_1",
        });
      }
      return Promise.resolve({
        type: "project",
        id: input.projectId,
        teamId: "team_1",
        organizationId: "org_1",
      });
    }),
    listUserCreatedRoles: vi.fn().mockResolvedValue([
      {
        id: "role_1",
        name: "Role",
        description: null,
        permissions: options?.customRolePermissions ?? ["project:view"],
        organizationId: "org_1",
        createdAt: new Date(1),
        updatedAt: new Date(1),
      },
    ]),
    listGroupBindings: vi.fn().mockResolvedValue([]),
    listOrganizationBindings: vi.fn().mockResolvedValue([]),
  } as unknown as AuthzService;

  const grants = {
    attachBindings: options?.grantsFailure
      ? vi.fn().mockRejectedValue(options.grantsFailure)
      : vi.fn().mockResolvedValue({ attached: ["binding_1"], duplicates: [] }),
    revokeBindings: vi.fn().mockResolvedValue(undefined),
    revokeBindingsWhere: vi.fn().mockResolvedValue(0),
  } as unknown as AuthzGrantsService;

  const service = OrganizationService.create({
    repository: {} as OrganizationRepository,
    teams: teamRepository,
    groups: groupRepository as unknown as GroupRepository,
    identities: {} as PersonalWorkspaceIdentityPort,
    teamIdentities: {} as TeamIdentityPort,
    groupIdentities: {
      createGroupId: () => "group_1",
      createBindingId: () => "binding_1",
      slugify: () => "reviewers",
    } as GroupIdentityPort,
    authz,
    grants,
  });

  return { service, groupRepository, teamRepository, authz, grants };
}

describe("OrganizationService groups", () => {
  it("validates all members before it creates a group", async () => {
    const failure = new UserNotInOrganizationError("foreign_user");
    const { service, groupRepository, teamRepository } = buildService({
      organizationMembersFailure: failure,
    });

    await expect(
      service.createGroup({
        organizationId: "org_1",
        name: "Reviewers",
        memberIds: ["member_1", "foreign_user", "member_1"],
        actor: { type: "user", id: "actor_1" },
      }),
    ).rejects.toBe(failure);

    expect(teamRepository.getOrganizationMembers).toHaveBeenCalledWith({
      organizationId: "org_1",
      userIds: ["member_1", "foreign_user"],
    });
    expect(groupRepository.create).not.toHaveBeenCalled();
  });

  it("refuses an organization-only custom permission below organization scope", async () => {
    const { service, groupRepository } = buildService({
      customRolePermissions: ["organization:manage"],
    });

    await expect(
      service.createGroup({
        organizationId: "org_1",
        name: "Reviewers",
        bindings: [
          {
            role: "CUSTOM",
            customRoleId: "role_1",
            scopeType: "TEAM",
            scopeId: "team_1",
          },
        ],
        actor: { type: "user", id: "actor_1" },
      }),
    ).rejects.toBeInstanceOf(GroupRoleScopeError);

    expect(groupRepository.create).not.toHaveBeenCalled();
  });

  it("maps an AuthZ duplicate to the stable group conflict", async () => {
    const { service } = buildService({
      grantsFailure: new DuplicateBindingError(),
    });

    await expect(
      service.addGroupBinding({
        organizationId: "org_1",
        groupId: "group_1",
        binding: {
          role: "MEMBER",
          scopeType: "TEAM",
          scopeId: "team_1",
        },
        actor: { type: "user", id: "actor_1" },
      }),
    ).rejects.toMatchObject({ code: "role_binding_already_exists" });
  });

  it("returns group persistence and AuthZ bindings through one service", async () => {
    const { service, authz } = buildService();
    vi.mocked(authz.listGroupBindings).mockResolvedValue([
      {
        id: "binding_1",
        organizationId: "org_1",
        userId: null,
        groupId: "group_1",
        apiKeyId: null,
        role: "MEMBER",
        customRoleId: null,
        scopeType: "TEAM",
        scopeId: "team_1",
        createdAt: new Date(1),
        user: null,
        group: null,
        apiKey: null,
        customRole: null,
      },
    ]);

    await expect(
      service.getGroup({ organizationId: "org_1", groupId: "group_1" }),
    ).resolves.toMatchObject({
      id: "group_1",
      bindings: [{ id: "binding_1", scopeId: "team_1" }],
    });
  });
});
