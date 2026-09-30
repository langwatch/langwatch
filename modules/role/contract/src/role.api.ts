/**
 * The callable role surface: custom-role definitions, who holds one, and the
 * catalog a definition is written from. A caller arrives as an argument, never
 * read from a session, so one operation serves every door.
 */
import { moduleApi } from "@langwatch/kernel/module-api";

import type { RolePermissionCatalog } from "./role-rest.schemas.ts";
import type { Role, RoleCreate, RoleUpdate, RoleWriteAcknowledged } from "./role.ts";

/**
 * Who a write is attributed to. `null` is a credential acting as no person —
 * the management API on its own credential — which the grants ledger records
 * as a system actor rather than as somebody.
 */
export interface RoleCaller {
  readonly id: string | null;
  /** The key a REST write arrived on: its own permissions, not its owner's, bound the write. */
  readonly apiKeyId?: string;
}

/** A signed-in person, for the reads that answer about the caller themselves. */
export interface RoleUserCaller {
  readonly id: string;
}

export interface RoleApi {
  /**
   * The organization's roles: the built-in ones first, then its custom ones.
   * `builtIn` true keeps only the built-ins, false only the custom roles.
   */
  listRoles(input: { organizationId: string; builtIn?: boolean }): Promise<Role[]>;
  /**
   * One custom role, for a caller whose standing at the role's organization is
   * established here: the organization is a row loaded by the role id, so no
   * declaration on the request can name it.
   */
  getRole(input: { roleId: string }, by: RoleUserCaller): Promise<Role>;
  /** A built-in id, or a custom role inside an organization the credential already resolved. */
  getRoleInOrganization(input: { roleId: string; organizationId: string }): Promise<Role>;
  createRole(input: { role: RoleCreate }, by: RoleCaller): Promise<Role>;
  updateRole(input: { roleId: string; changes: RoleUpdate }, by: RoleUserCaller): Promise<Role>;
  updateRoleInOrganization(
    input: { roleId: string; organizationId: string; changes: RoleUpdate },
    by: RoleCaller,
  ): Promise<Role>;
  deleteRole(input: { roleId: string }, by: RoleUserCaller): Promise<RoleWriteAcknowledged>;
  deleteRoleInOrganization(
    input: { roleId: string; organizationId: string },
    by: RoleCaller,
  ): Promise<RoleWriteAcknowledged>;
  assignRoleToUser(
    input: { userId: string; teamId: string; customRoleId: string },
    by: RoleCaller,
  ): Promise<RoleWriteAcknowledged>;
  removeRoleFromUser(
    input: { userId: string; teamId: string },
    by: RoleCaller,
  ): Promise<RoleWriteAcknowledged>;
  /** The organization a team assignment lands in; an unnamed team is a refusal. */
  getAssignmentOrganization(input: { teamId: string }): Promise<string>;
  /** The role ids of the listed set that this organization may actually assign. */
  filterAssignableRoles(input: { roleIds: string[]; organizationId: string }): Promise<string[]>;
  /** Every resource with its actions, and whether it binds at organization scope only. */
  getPermissionCatalog(): Promise<RolePermissionCatalog>;
}

export const RoleApi = moduleApi<RoleApi>()("role");
