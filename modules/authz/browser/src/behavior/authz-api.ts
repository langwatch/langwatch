/**
 * Hand-written procedures/hooks (meant to be generated). Segment names are
 * load-bearing for React Query cache key consistency (ADR-004 exception).
 */

import { createModuleApi, type OutputsFromMap } from "@langwatch/api/web";
import type { AuthzPermission } from "@langwatch/authorization";
import type {
  AuthzChangeGrantRoleInput,
  AuthzCreateGrantInput,
  AuthzListGrantsInput,
  AuthzManagedOrganizationBinding,
  AuthzOwnStanding,
  AuthzRevokeGrantByIdInput,
  Grant,
  GrantPage,
  GrantRevoked,
} from "@langwatch/authz-contract";
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

  /** Grants, the Access tab's list and writes; the session is the caller, never the input. */
  authz: {
    effectivePermissions: {
      query: { input: { organizationId?: string; projectId?: string }; output: AuthzOwnStanding };
    };
    listGrants: { query: { input: AuthzListGrantsInput; output: GrantPage } };
    createGrant: {
      mutation: { input: Omit<AuthzCreateGrantInput, "caller" | "actor">; output: Grant };
    };
    changeGrantRole: {
      mutation: { input: Omit<AuthzChangeGrantRoleInput, "caller" | "actor">; output: Grant };
    };
    revokeGrant: {
      mutation: { input: Omit<AuthzRevokeGrantByIdInput, "actor">; output: GrantRevoked };
    };
    /**
     * Every grant in the organization, principals and scopes named: audit-grade
     * data, which is why the procedure is gated at `organization:manage`.
     */
    listManagedGrants: {
      query: { input: OrganizationScope; output: AuthzManagedOrganizationBinding[] };
    };
  };

  organization: {
    /**
     * The workspace graph the shell already reads, narrowed to what the role
     * preview's scope picker offers; the same key, so no second request.
     */
    getAllOrganizationMembers: {
      query: {
        input: OrganizationScope;
        output: { id: string; name: string | null; email: string | null }[];
      };
    };

    getAll: {
      query: {
        input: { isDemo?: boolean };
        output: {
          id: string;
          name: string;
          teams: { id: string; name: string; projects: { id: string; name: string }[] }[];
        }[];
      };
    };
  };

  /** Who a grant can name: the organization's members and its groups. */
  group: {
    listAll: {
      query: { input: OrganizationScope; output: { id: string; name: string }[] };
    };
  };

  plan: {
    /** The organization's plan, narrowed to the one fact these pages need: Enterprise or not. */
    getActivePlan: {
      query: { input: OrganizationScope; output: { type: string } };
    };
  };
};

/**
 * The AuthZ family's typed tRPC hooks: same machinery, transport and React
 * Query cache as the application's `api` proxy (see `createModuleApi`).
 * INTERNAL by convention: screens call it, the shell mounts `authzApi.Provider`.
 */
export const authzApi = createModuleApi<AuthzApiMap>();

/** What each procedure answers, as the wire carries it (dates as strings). */
export type RouterOutputs = OutputsFromMap<AuthzApiMap>;
