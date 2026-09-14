/**
 * Hand-written procedures/hooks (meant to be generated). Segment names are
 * load-bearing for React Query cache key consistency (ADR-004 exception).
 */

import type { AuthzManagedOrganizationBinding, AuthzPermission } from "@langwatch/authz-contract";
import { createModuleApi } from "@langwatch/api/web";
import type { Role } from "@langwatch/role-contract";

/** One organization, the tenant key every procedure on these surfaces takes. */
type OrganizationScope = { organizationId: string };

/** One custom role, named on its own — the role carries its own organization. */
type RoleScope = { roleId: string };

export type AuthzApiMap = {
  role: {
    /**
     * Every custom role defined in the organization.
     *
     * Gated at `organization:manage` rather than `organization:view`: a role
     * definition is a privilege-escalation surface, since whoever reads the
     * definitions learns exactly which permissions are worth acquiring.
     */
    getAll: { query: { input: OrganizationScope; output: Role[] } };

    /**
     * One role with full permissions; ensure editor reads server state, not
     * stale list.
     */
    getById: { query: { input: RoleScope; output: Role } };

    create: {
      mutation: {
        input: OrganizationScope & {
          name: string;
          description?: string;
          permissions: AuthzPermission[];
        };
        output: Role;
      };
    };

    update: {
      mutation: {
        input: RoleScope & {
          name?: string;
          description?: string;
          permissions?: AuthzPermission[];
        };
        output: Role;
      };
    };

    delete: { mutation: { input: RoleScope; output: { success: true } } };
  };

  roleBinding: {
    /**
     * Every role binding in the organization — audit-grade RBAC data, which is
     * why the procedure is gated at `organization:manage` and why the page
     * behind it is too.
     */
    listForOrg: {
      query: { input: OrganizationScope; output: AuthzManagedOrganizationBinding[] };
    };
  };
};

/**
 * The AuthZ family's typed tRPC hooks. Same machinery, same transport and same
 * React Query cache as the application's `api` proxy — see `createModuleApi`
 * for why separate instances still share cache entries.
 *
 * INTERNAL to this package by convention: the screens call it, and the process
 * shell mounts `authzApi.Provider`.
 */
export const authzApi = createModuleApi<AuthzApiMap>();
