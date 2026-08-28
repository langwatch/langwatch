import type { LedgerActor } from "@langwatch/actor";
import {
  OrgExclusivePermissionScopeError,
  ROLE_KIND,
  RoleInUseError,
  RoleNotFoundError,
  TeamNotFoundError,
  type Role,
  type RoleCreate,
  type RoleUpdate,
} from "@langwatch/role-contract";
import { describe, expect, it, vi } from "vitest";
import { RolePermissionPort, RoleScopePort } from "../src/ports/role.port";
import { RoleRepository } from "../src/repositories/role.repository";
import { RoleService } from "../src/services/role.service";

const actor: LedgerActor = { type: "system", id: null };

const role = (overrides: Partial<Role> = {}): Role => ({
  id: "role-1",
  organizationId: "org-1",
  name: "Reviewer",
  description: null,
  permissions: ["traces:view"],
  kind: ROLE_KIND.CUSTOM,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

class TestRoleRepository extends RoleRepository {
  roles = new Map<string, Role>();
  team: { organizationId: string } | null = { organizationId: "org-1" };
  member = true;
  bindingCount = 0;
  assignedCount = 0;
  deleteResult = true;
  afterDeleteBindingCount: number | null = null;
  readonly createCall = vi.fn();
  readonly assignCall = vi.fn();

  findAll(organizationId: string): Promise<Role[]> {
    return Promise.resolve(
      [...this.roles.values()].filter((candidate) => candidate.organizationId === organizationId),
    );
  }

  tryFindById(roleId: string): Promise<Role | null> {
    return Promise.resolve(this.roles.get(roleId) ?? null);
  }

  async tryFindCustomByIdInOrganization(input: {
    roleId: string;
    organizationId: string;
  }): Promise<Role | null> {
    const found = await this.tryFindById(input.roleId);
    return found?.organizationId === input.organizationId ? found : null;
  }

  tryFindTeam(): Promise<{ organizationId: string } | null> {
    return Promise.resolve(this.team);
  }

  hasTeamMember(): Promise<boolean> {
    return Promise.resolve(this.member);
  }

  tryFindUserBinding(): Promise<{ customRoleId: string } | null> {
    return Promise.resolve(null);
  }

  findAssignable(roleIds: string[], organizationId: string) {
    return Promise.resolve(
      roleIds.flatMap((id) => {
        const found = this.roles.get(id);
        return found?.organizationId === organizationId ? [{ id }] : [];
      }),
    );
  }

  findAssignablePermissions(roleIds: string[], organizationId: string) {
    return Promise.resolve(
      roleIds.flatMap((id) => {
        const found = this.roles.get(id);
        return found?.organizationId === organizationId
          ? [{ id, permissions: found.permissions }]
          : [];
      }),
    );
  }

  countRoleBindings(): Promise<number> {
    return Promise.resolve(this.bindingCount);
  }

  countAssignedUsers(): Promise<number> {
    return Promise.resolve(this.assignedCount);
  }

  create(input: { role: RoleCreate; actor: LedgerActor }): Promise<Role> {
    this.createCall(input);
    const created = role({
      id: "created-role",
      organizationId: input.role.organizationId,
      name: input.role.name,
      description: input.role.description ?? null,
      permissions: input.role.permissions,
    });
    this.roles.set(created.id, created);
    return Promise.resolve(created);
  }

  async update(input: { roleId: string; changes: RoleUpdate; actor: LedgerActor }): Promise<Role> {
    const current = this.roles.get(input.roleId);
    if (!current) throw new RoleNotFoundError(input.roleId);
    const updated = { ...current, ...input.changes };
    this.roles.set(input.roleId, updated);
    return updated;
  }

  deleteIfUnused(): Promise<boolean> {
    if (!this.deleteResult && this.afterDeleteBindingCount !== null) {
      this.bindingCount = this.afterDeleteBindingCount;
    }
    return Promise.resolve(this.deleteResult);
  }

  assign(input: {
    userId: string;
    teamId: string;
    customRoleId: string;
    actor: LedgerActor;
  }): Promise<void> {
    this.assignCall(input);
    return Promise.resolve();
  }

  remove(): Promise<void> {
    return Promise.resolve();
  }

  isExclusiveToApiKey(): Promise<boolean> {
    return Promise.resolve(false);
  }

  removeExclusiveApiKeyRoles(): Promise<void> {
    return Promise.resolve();
  }
}

class TestScopePort extends RoleScopePort {
  assertNoPersonalTeamScope(): Promise<void> {
    return Promise.resolve();
  }
}

class TestPermissionPort extends RolePermissionPort {
  isOrganizationExclusive(permission: string): boolean {
    return permission === "organization:manage";
  }

  organizationExclusiveScopeError(input: {
    permission: string;
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  }): Error {
    return new OrgExclusivePermissionScopeError(input.permission, input.scopeType);
  }
}

const serviceWith = (repository: TestRoleRepository) =>
  RoleService.create({
    repository,
    scope: new TestScopePort(),
    permission: new TestPermissionPort(),
  });

describe("Role service", () => {
  it("creates an organization-scoped custom role through its repository", async () => {
    const repository = new TestRoleRepository();
    const created = await serviceWith(repository).create({
      role: {
        organizationId: "org-1",
        name: "Reviewer",
        permissions: ["traces:view"],
      },
      actor,
    });

    expect(created.organizationId).toBe("org-1");
    expect(repository.createCall).toHaveBeenCalledOnce();
  });

  it("does not reveal a role from another organization", async () => {
    const repository = new TestRoleRepository();
    repository.roles.set("role-1", role());

    await expect(
      serviceWith(repository).getForOrganization({
        roleId: "role-1",
        organizationId: "org-2",
      }),
    ).rejects.toBeInstanceOf(RoleNotFoundError);
  });

  it("refuses an organization-exclusive role at team scope", async () => {
    const repository = new TestRoleRepository();
    repository.roles.set("role-1", role({ permissions: ["organization:manage"] }));

    await expect(
      serviceWith(repository).assignToUser({
        userId: "user-1",
        teamId: "team-1",
        customRoleId: "role-1",
        actor,
      }),
    ).rejects.toBeInstanceOf(OrgExclusivePermissionScopeError);
    expect(repository.assignCall).not.toHaveBeenCalled();
  });

  it("resolves the assignment organization without exposing Role persistence", async () => {
    const repository = new TestRoleRepository();

    await expect(
      serviceWith(repository).getAssignmentOrganization({ teamId: "team-1" }),
    ).resolves.toBe("org-1");

    repository.team = null;
    await expect(
      serviceWith(repository).getAssignmentOrganization({ teamId: "missing-team" }),
    ).rejects.toBeInstanceOf(TeamNotFoundError);
  });

  it("refuses deletion while a grant references the role", async () => {
    const repository = new TestRoleRepository();
    repository.roles.set("role-1", role());
    repository.bindingCount = 1;

    await expect(
      serviceWith(repository).removeForOrganization({
        roleId: "role-1",
        organizationId: "org-1",
        actor,
      }),
    ).rejects.toBeInstanceOf(RoleInUseError);
  });

  it("reports a holder that wins the guarded deletion race", async () => {
    const repository = new TestRoleRepository();
    repository.roles.set("role-1", role());
    repository.deleteResult = false;
    repository.afterDeleteBindingCount = 1;

    await expect(
      serviceWith(repository).removeForOrganization({
        roleId: "role-1",
        organizationId: "org-1",
        actor,
      }),
    ).rejects.toMatchObject({
      code: "custom_role_in_use",
      bindingCount: 1,
    });
  });
});
