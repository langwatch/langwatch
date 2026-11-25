import type { Role } from "@langwatch/role-contract";

/**
 * The custom-role rows this feature owns, and the legacy team assignments that
 * name one. A definition is WRITTEN through the grants ledger, never here, so
 * this interface reads and counts and nothing else.
 */
export interface RoleRepository {
  findById(input: { roleId: string }): Promise<Role | undefined>;
  findCustomInOrganization(input: {
    roleId: string;
    organizationId: string;
  }): Promise<Role | undefined>;
  /** The role holding this name in the organization, for the uniqueness check. */
  findByName(input: { organizationId: string; name: string }): Promise<{ id: string } | undefined>;
  /** Of the listed ids, the ones this organization defines as custom roles. */
  findAssignable(input: { roleIds: string[]; organizationId: string }): Promise<{ id: string }[]>;
  /** How many legacy team assignments still hand this role out. */
  countAssignedUsers(input: { roleId: string }): Promise<number>;
}
