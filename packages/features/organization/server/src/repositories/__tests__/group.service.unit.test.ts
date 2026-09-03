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
} from "../../ports/organization.port";
import type { GroupRepository } from "../group.repository";
import type { TeamRepository } from "../team.repository";
import { OrganizationService } from "../../services/organization.service";

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
  /** The stored group every read resolves to; a `scimSource` makes it directory-managed. */
  storedGroup?: OrganizationGroup;
}) {
  const storedGroup = options?.storedGroup ?? group;
  const groupRepository = {
    get: vi.fn().mockResolvedValue(storedGroup),
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

  /**
   * Ported from the groups REST suite
   * (`platform/app/src/app/api/groups/__tests__/groups-rest-api.integration.test.ts`),
   * which reached these guards through HTTP and a real database. The guards
   * themselves are the service's, so this is where they belong: the REST family
   * only turns the refusal into a status.
   *
   * A directory-managed group answers `scim_managed_group` — a conflict with
   * the identity provider that owns it, not a malformed request: whatever an
   * administrator changed here would come back on the next sync.
   */
  describe("given a group its identity provider owns", () => {
    const directoryManaged: OrganizationGroup = { ...group, scimSource: "okta" };

    /** @scenario PATCH /api/groups/:id rejects rename of SCIM-managed group */
    it("refuses a rename and writes nothing", async () => {
      const { service, groupRepository } = buildService({ storedGroup: directoryManaged });

      await expect(
        service.renameGroup({
          organizationId: "org_1",
          groupId: "group_1",
          name: "New Name",
        }),
      ).rejects.toMatchObject({ code: "scim_managed_group" });

      expect(groupRepository.rename).not.toHaveBeenCalled();
    });

    /** @scenario DELETE /api/groups/:id rejects deleting a SCIM-managed group */
    it("refuses a delete and leaves the group and its bindings in place", async () => {
      const { service, groupRepository, grants } = buildService({
        storedGroup: directoryManaged,
      });

      await expect(
        service.deleteGroup({
          organizationId: "org_1",
          groupId: "group_1",
          actor: { type: "user", id: "actor_1" },
        }),
      ).rejects.toMatchObject({ code: "scim_managed_group" });

      expect(groupRepository.delete).not.toHaveBeenCalled();
      expect(grants.revokeBindingsWhere).not.toHaveBeenCalled();
    });

    /**
     * The one caller allowed through is the directory sync itself, which asks
     * for the deletion the directory has already made.
     */
    it("deletes it for a caller that names itself the directory", async () => {
      const { service, groupRepository } = buildService({ storedGroup: directoryManaged });

      await service.deleteGroup({
        organizationId: "org_1",
        groupId: "group_1",
        allowScimManaged: true,
        actor: { type: "user", id: "actor_1" },
      });

      expect(groupRepository.delete).toHaveBeenCalledOnce();
    });

    /** @scenario POST /api/groups/:id/members rejects adding to SCIM-managed group */
    it("refuses a member being added", async () => {
      const { service, groupRepository } = buildService({ storedGroup: directoryManaged });

      await expect(
        service.addGroupMember({
          organizationId: "org_1",
          groupId: "group_1",
          userId: "member_1",
        }),
      ).rejects.toMatchObject({ code: "scim_managed_group" });

      expect(groupRepository.addMember).not.toHaveBeenCalled();
    });

    /** @scenario DELETE /api/groups/:id/members/:userId rejects removal from SCIM group */
    it("refuses a member being removed", async () => {
      const { service, groupRepository } = buildService({ storedGroup: directoryManaged });

      await expect(
        service.removeGroupMember({
          organizationId: "org_1",
          groupId: "group_1",
          userId: "member_1",
        }),
      ).rejects.toMatchObject({ code: "scim_managed_group" });

      expect(groupRepository.removeMember).not.toHaveBeenCalled();
    });
  });

  describe("when a member is added to a group", () => {
    /** @scenario POST /api/groups/:id/members rejects non-org user */
    it("refuses somebody the organization does not have", async () => {
      const failure = new UserNotInOrganizationError("outsider");
      const { service, groupRepository, teamRepository } = buildService({
        organizationMembersFailure: failure,
      });

      await expect(
        service.addGroupMember({
          organizationId: "org_1",
          groupId: "group_1",
          userId: "outsider",
        }),
      ).rejects.toMatchObject({ code: "user_not_in_organization" });

      expect(teamRepository.getOrganizationMembers).toHaveBeenCalledWith({
        organizationId: "org_1",
        userIds: ["outsider"],
      });
      expect(groupRepository.addMember).not.toHaveBeenCalled();
    });
  });
});
