import {
  RoleDuplicateNameError,
  RoleNotFoundError,
  RoleReservedNameError,
  ROLE_KIND,
  type Role,
} from "@langwatch/role-contract";
import type { RoleRepository } from "../repositories/role.repository.ts";

/** Names the API-key mint reserves, so a person cannot define one by hand. */
const RESERVED_ROLE_NAME_PREFIX = "apikey:";

/** The custom-role definitions, as this feature's own rows answer for them. */
export class RoleService {
  #repository: RoleRepository;

  private constructor(repository: RoleRepository) {
    this.#repository = repository;
  }

  static create({ repository }: { repository: RoleRepository }): RoleService {
    return new RoleService(repository);
  }

  /** One custom role by id. A system role reads as absent. */
  async getById(input: { roleId: string }): Promise<Role> {
    const role = await this.#repository.findById(input);
    if (!role || role.kind !== ROLE_KIND.CUSTOM) throw new RoleNotFoundError(input.roleId);

    return role;
  }

  /**
   * One custom role inside one organization. A role id from another
   * organization reads as absent, never as someone else's role.
   */
  async getInOrganization(input: { roleId: string; organizationId: string }): Promise<Role> {
    const role = await this.#repository.findCustomInOrganization(input);
    if (!role) throw new RoleNotFoundError(input.roleId);

    return role;
  }

  /** How many legacy team assignments still hand this role out. */
  countAssignedUsers(input: { roleId: string }): Promise<number> {
    return this.#repository.countAssignedUsers(input);
  }

  /** Of the listed ids, the ones this organization may actually assign. */
  async filterAssignable(input: { roleIds: string[]; organizationId: string }): Promise<string[]> {
    if (input.roleIds.length === 0) return [];

    const assignable = await this.#repository.findAssignable(input);

    return assignable.map((role) => role.id);
  }

  /** Refuses a name the API-key mint reserves for itself. */
  assertNameAllowed(name: string | undefined): void {
    if (name?.startsWith(RESERVED_ROLE_NAME_PREFIX)) throw new RoleReservedNameError();
  }

  /** Refuses a name another role in the same organization already holds. */
  async assertNameAvailable(input: {
    organizationId: string;
    name: string;
    exceptRoleId?: string;
  }): Promise<void> {
    const holder = await this.#repository.findByName({
      organizationId: input.organizationId,
      name: input.name,
    });

    if (holder && holder.id !== input.exceptRoleId) throw new RoleDuplicateNameError();
  }
}
