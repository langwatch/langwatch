import { ROLE_KIND, roleSchema, type Role } from "@langwatch/role-contract";
import type { RoleRepository } from "../role.repository.ts";

/**
 * The same reads over a map. A definition is written through the grants
 * ledger, so `save` and `assign` are how a test states the rows a ledger would
 * have produced.
 */
export class MemoryRoleRepository implements RoleRepository {
  #roles = new Map<string, Role>();
  #assignments: { userId: string; teamId: string; customRoleId: string }[] = [];

  private constructor() {}

  static create(): MemoryRoleRepository {
    return new MemoryRoleRepository();
  }

  /** States one stored role, parsed by the same schema Prisma rows return through. */
  save(role: Role): Role {
    const stored = roleSchema.parse(role);
    this.#roles.set(stored.id, stored);

    return stored;
  }

  /** States one legacy team assignment of a custom role. */
  assign(assignment: { userId: string; teamId: string; customRoleId: string }): void {
    this.#assignments.push(assignment);
  }

  /** Forgets one stored role, as the ledger's delete would. */
  forget(input: { roleId: string }): void {
    this.#roles.delete(input.roleId);
  }

  async findById(input: { roleId: string }): Promise<Role | undefined> {
    return this.#roles.get(input.roleId);
  }

  async findCustomInOrganization(input: {
    roleId: string;
    organizationId: string;
  }): Promise<Role | undefined> {
    const role = this.#roles.get(input.roleId);

    return role?.organizationId === input.organizationId && role.kind === ROLE_KIND.CUSTOM
      ? role
      : void 0;
  }

  async findByName(input: {
    organizationId: string;
    name: string;
  }): Promise<{ id: string } | undefined> {
    const role = [...this.#roles.values()].find(
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
      const role = this.#roles.get(roleId);

      return role?.organizationId === input.organizationId && role.kind === ROLE_KIND.CUSTOM
        ? [{ id: roleId }]
        : [];
    });
  }

  async countAssignedUsers(input: { roleId: string }): Promise<number> {
    return this.#assignments.filter((assignment) => assignment.customRoleId === input.roleId)
      .length;
  }
}
