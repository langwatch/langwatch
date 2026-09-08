/**
 * The callable role surface: custom-role definitions, who holds one, and the
 * catalog a definition is written from. A caller arrives as an argument, never
 * read from a session, so one operation serves every door.
 */
import type {
  AuthzAccessBreakdownOutput,
  AuthzApplyMemberBindingsInput,
  AuthzBindingMutationSuccess,
  AuthzCreateBindingInput,
  AuthzCreateBindingOutput,
  AuthzDeleteBindingInput,
  AuthzListManagedBindingsForOrganizationOutput,
  AuthzListManagedBindingsForUserOutput,
  AuthzUpdateBindingInput,
} from "@langwatch/authz-contract";
import { featureApi } from "@langwatch/runtime-composition";
import type { RolePermissionCatalog } from "./role-rest.schemas.ts";
import type { Role, RoleCreate, RoleUpdate, RoleWriteAcknowledged } from "./role.ts";

/**
 * Who a write is attributed to. `null` is a credential acting as no person —
 * the management API on its own credential — which the grants ledger records
 * as a system actor rather than as somebody.
 */
export interface RoleCaller {
  readonly id: string | null;
}

/** A signed-in person, for the reads that answer about the caller themselves. */
export interface RoleUserCaller {
  readonly id: string;
}

export interface RoleApi {
  /** Every custom role the organization defines. */
  listRoles(input: { organizationId: string }): Promise<Role[]>;
  /**
   * One custom role, for a caller whose standing at the role's organization is
   * established here: the organization is a row loaded by the role id, so no
   * declaration on the request can name it.
   */
  getRole(input: { roleId: string }, by: RoleUserCaller): Promise<Role>;
  /** One custom role inside an organization the credential already resolved. */
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
  listBindingsForOrganization(input: {
    organizationId: string;
  }): Promise<AuthzListManagedBindingsForOrganizationOutput>;
  listBindingsForUser(input: {
    organizationId: string;
    userId: string;
  }): Promise<AuthzListManagedBindingsForUserOutput>;
  /** The caller's own standing: organization role, groups, direct bindings. */
  getCallerAccessBreakdown(
    input: { organizationId: string },
    by: RoleUserCaller,
  ): Promise<AuthzAccessBreakdownOutput>;
  createBinding(
    input: Omit<AuthzCreateBindingInput, "actor">,
    by: RoleCaller,
  ): Promise<AuthzCreateBindingOutput>;
  updateBinding(
    input: Omit<AuthzUpdateBindingInput, "actor">,
    by: RoleCaller,
  ): Promise<AuthzCreateBindingOutput>;
  deleteBinding(
    input: Omit<AuthzDeleteBindingInput, "actor">,
    by: RoleCaller,
  ): Promise<AuthzBindingMutationSuccess>;
  applyMemberBindings(
    input: Omit<AuthzApplyMemberBindingsInput, "actor">,
    by: RoleCaller,
  ): Promise<AuthzBindingMutationSuccess>;
}

export const RoleApi = featureApi<RoleApi>("role");
