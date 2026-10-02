import { ROLE_KIND, type Role } from "@langwatch/role-contract";

import type { RoleRepository } from "../role.repository.ts";
import { MemoryRoleStore } from "./memory.role.store.ts";

/** The same reads over the {@link MemoryRoleStore} a test states rows in. */
export class MemoryRoleRepository implements RoleRepository {
  private constructor(private readonly store: MemoryRoleStore) {}

  static create({
    store = MemoryRoleStore.create(),
  }: { store?: MemoryRoleStore } = {}): MemoryRoleRepository {
    return new MemoryRoleRepository(store);
  }

  async findById(input: { roleId: string }): Promise<Role | undefined> {
    return this.store.roles.get(input.roleId);
  }

  async findCustomInOrganization(input: {
    roleId: string;
    organizationId: string;
  }): Promise<Role | undefined> {
    const role = this.store.roles.get(input.roleId);

    return role?.organizationId === input.organizationId && role.kind === ROLE_KIND.CUSTOM
      ? role
      : void 0;
  }

  async findByName(input: {
    organizationId: string;
    name: string;
  }): Promise<{ id: string } | undefined> {
    const role = [...this.store.roles.values()].find(
      (candidate) =>
        candidate.organizationId === input.organizationId && candidate.name === input.name,
    );

    return role ? { id: role.id } : void 0;
  }

  async findAssignable(input: {
    roleIds: string[];
    organizationId: string;
  }): Promise<{ id: string }[]> {
    return input.roleIds.flatMap((roleId) => {
      const role = this.store.roles.get(roleId);

      return role?.organizationId === input.organizationId && role.kind === ROLE_KIND.CUSTOM
        ? [{ id: roleId }]
        : [];
    });
  }

  async countAssignedUsers(input: { roleId: string }): Promise<number> {
    return this.store.assignments.filter((assignment) => assignment.customRoleId === input.roleId)
      .length;
  }
}
