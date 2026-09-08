import { featureApi } from "@langwatch/runtime-composition";
import type { Role, RoleCreate, RoleUpdate } from "./role.ts";
import type {
  AuthzAccessBreakdownOutput,
  AuthzBindingMutationSuccess,
  AuthzCreateBindingInput,
  AuthzCreateBindingOutput,
  AuthzDeleteBindingInput,
  AuthzListManagedBindingsForOrganizationOutput,
  AuthzListManagedBindingsForUserOutput,
  AuthzUpdateBindingInput,
} from "@langwatch/authz-contract";
export interface RoleCaller {
  readonly id: string;
}

/** The callable role domain surface. Transport attribution remains explicit. */
export interface RoleApi {
  listRoles(input: { organizationId: string }): Promise<Role[]>;
  getRole(input: { roleId: string }): Promise<Role>;
  createRole(input: { role: RoleCreate }, by: RoleCaller): Promise<Role>;
  updateRole(input: { roleId: string; changes: RoleUpdate }, by: RoleCaller): Promise<Role>;
  deleteRole(input: { roleId: string }, by: RoleCaller): Promise<{ success: true }>;
  assignRoleToUser(
    input: { userId: string; teamId: string; customRoleId: string },
    by: RoleCaller,
  ): Promise<{ success: true }>;
  removeRoleFromUser(
    input: { userId: string; teamId: string },
    by: RoleCaller,
  ): Promise<{ success: true }>;
  getAssignmentOrganization(input: { teamId: string }): Promise<string>;
  listBindingsForOrganization(input: {
    organizationId: string;
  }): Promise<AuthzListManagedBindingsForOrganizationOutput>;
  listBindingsForUser(input: {
    organizationId: string;
    userId: string;
  }): Promise<AuthzListManagedBindingsForUserOutput>;
  getCallerAccessBreakdown(
    input: { organizationId: string; userName: string | null; userEmail: string | null },
    by: RoleCaller,
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
}

export const RoleApi = featureApi<RoleApi>("role");
