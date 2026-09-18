/**
 * Hand-written procedures/hooks (meant to be generated). Segment names are
 * load-bearing for React Query cache key consistency (ADR-004 exception).
 */

import { createModuleApi } from "@langwatch/api/web";
import type { AuthzManagedOrganizationBinding, AuthzPermission } from "@langwatch/authz-contract";
import type { Role } from "@langwatch/role-contract";

/** One organization, the tenant key every procedure on these surfaces takes. */
type OrganizationScope = { organizationId: string };

/** One custom role, named on its own — the role carries its own organization. */
type RoleScope = { roleId: string };

export type AuthzApiMap = {
  role: {
    /**
     * Every custom role defined in the organization. Gated at
     * `organization:manage` rather than `organization:view`: reading role
     * definitions is a privilege-escalation surface (they show what's worth acquiring).
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
 * The AuthZ family's typed tRPC hooks: same machinery, transport and React
 * Query cache as the application's `api` proxy (see `createModuleApi`).
 * INTERNAL by convention: screens call it, the shell mounts `authzApi.Provider`.
 */
export const authzApi = createModuleApi<AuthzApiMap>();
