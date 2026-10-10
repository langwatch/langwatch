import {
  assertEnterprisePlanType,
  ENTERPRISE_FEATURE_ERRORS,
  type EntitlementApi,
} from "@langwatch/entitlement-contract";
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
  #entitlement: Pick<EntitlementApi, "getActivePlan">;

  private constructor(
    repository: RoleRepository,
    entitlement: Pick<EntitlementApi, "getActivePlan">,
  ) {
    this.#repository = repository;
    this.#entitlement = entitlement;
  }

  static create({
    repository,
    entitlement,
  }: {
    repository: RoleRepository;
    entitlement: Pick<EntitlementApi, "getActivePlan">;
  }): RoleService {
    return new RoleService(repository, entitlement);
  }

  /** Refuses an organization whose plan does not carry custom roles, asked on the loaded role. */
  async assertCustomRolesAllowed({ organizationId }: { organizationId: string }): Promise<void> {
    const plan = await this.#entitlement.getActivePlan({ organizationId });
    assertEnterprisePlanType({
      planType: plan.type,
      errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
    });
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

  /** Refuses a name another live role in the organization holds. A deleted
   *  role's compat row is gone, so its name is free, as the live-only index says. */
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
