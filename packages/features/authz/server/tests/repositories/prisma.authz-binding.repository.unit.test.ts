import { describe, expect, it, vi } from "vitest";
import {
  type AuthzBindingDatabase,
  PrismaAuthzBindingRepository,
} from "../../src/repositories/prisma/prisma.authz-binding.repository";

function setup() {
  const delegate = () => ({
    count: vi.fn().mockResolvedValue(0),
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  });
  const database = {
    apiKey: delegate(),
    customRole: delegate(),
    group: delegate(),
    groupMembership: delegate(),
    organization: delegate(),
    organizationUser: delegate(),
    project: delegate(),
    roleBinding: delegate(),
    team: delegate(),
    teamUser: delegate(),
  } satisfies AuthzBindingDatabase;
  return {
    database,
    repository: PrismaAuthzBindingRepository.create(database),
  };
}

describe("PrismaAuthzBindingRepository", () => {
  it("finds a binding only inside the named organization", async () => {
    const { database, repository } = setup();

    await repository.tryFindBinding({
      organizationId: "org-1",
      bindingId: "binding-1",
    });

    expect(database.roleBinding.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "binding-1", organizationId: "org-1" },
      }),
    );
  });

  it("counts legacy access only through shared teams in the organization", async () => {
    const { database, repository } = setup();

    await repository.hasLegacySharedTeamMembership({
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(database.teamUser.count).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        team: { organizationId: "org-1", isPersonal: false },
      },
    });
  });

  it("fences scope decoration to the target organization", async () => {
    const { database, repository } = setup();
    database.organization.findMany.mockResolvedValue([{ id: "org-1", name: "Acme" }]);
    database.team.findMany.mockResolvedValue([{ id: "team-1", name: "Shared", isPersonal: false }]);
    database.project.findMany.mockResolvedValue([
      {
        id: "project-1",
        name: "Personal Project",
        isPersonal: true,
        team: { isPersonal: true, name: "Alice's Workspace" },
      },
    ]);

    const rows = await repository.findScopeRows({
      organizationId: "org-1",
      scopes: [
        { scopeType: "ORGANIZATION", scopeId: "org-1" },
        { scopeType: "ORGANIZATION", scopeId: "org-foreign" },
        { scopeType: "TEAM", scopeId: "team-1" },
        { scopeType: "PROJECT", scopeId: "project-1" },
      ],
    });

    expect(database.organization.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["org-1"] } },
      select: { id: true, name: true },
    });
    expect(database.team.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["team-1"] }, organizationId: "org-1" },
      }),
    );
    expect(database.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["project-1"] },
          team: { organizationId: "org-1" },
        },
      }),
    );
    expect(rows).toContainEqual({
      type: "PROJECT",
      id: "project-1",
      name: "Personal Project",
      personalWorkspaceName: "Alice's Workspace",
    });
  });

  it("fences group expansion to current organization memberships", async () => {
    const { database, repository } = setup();

    await repository.findGroupMembers({
      organizationId: "org-1",
      groupIds: ["group-1"],
    });

    expect(database.groupMembership.findMany).toHaveBeenCalledWith({
      where: {
        groupId: { in: ["group-1"] },
        group: { organizationId: "org-1" },
        user: { orgMemberships: { some: { organizationId: "org-1" } } },
      },
      select: { groupId: true, userId: true },
    });
  });

  it("selects only the named member's direct bindings for batch deletion", async () => {
    const { database, repository } = setup();

    await repository.findDirectUserBindings({
      organizationId: "org-1",
      userId: "user-1",
      bindingIds: ["binding-1", "binding-foreign"],
    });

    expect(database.roleBinding.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["binding-1", "binding-foreign"] },
          organizationId: "org-1",
          userId: "user-1",
          groupId: null,
        },
      }),
    );
  });

  it("accepts only user-created roles owned by the organization", async () => {
    const { database, repository } = setup();

    await repository.findAssignableRoles({
      organizationId: "org-1",
      roleIds: ["role-1", "role-foreign"],
    });

    expect(database.customRole.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["role-1", "role-foreign"] },
        organizationId: "org-1",
        kind: "custom",
      },
      select: { id: true, permissions: true },
    });
  });
});
