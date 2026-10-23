/**
 * Hand-written procedures/hooks (meant to be generated). Segment names are
 * load-bearing for React Query cache key consistency (ADR-004 exception).
 */

import { createModuleApi, type OutputsFromMap } from "@langwatch/api/web";
import type { AuthzPermission } from "@langwatch/authorization";
import type {
  AuthzBraid,
  AuthzBraidRemoved,
  AuthzBraidTargets,
  AuthzChangeBraidInput,
  AuthzCreateBraidInput,
  AuthzProjectMembersHolding,
  AuthzChangeGrantRoleInput,
  AuthzCreateGrantInput,
  AuthzListGrantsInput,
  AuthzManagedOrganizationBinding,
  AuthzOrganizationBraids,
  AuthzOrganizationPolicy,
  AuthzOwnStanding,
  AuthzProjectBraids,
  AuthzRemoveBraidInput,
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
      mutation: {
        input: Omit<AuthzRevokeGrantByIdInput, "caller" | "actor">;
        output: GrantRevoked;
      };
    };
    /**
     * Every grant in the organization, principals and scopes named: audit-grade
     * data, which is why the procedure is gated at `organization:manage`.
     */
    listManagedGrants: {
      query: { input: OrganizationScope; output: AuthzManagedOrganizationBinding[] };
    };

    /** A project's braids, both directions; any member of either project reads them. */
    listBraids: {
      query: { input: { projectId: string }; output: AuthzProjectBraids };
    };
    /** Either side's admins, on any plan: stopping a braid only narrows access. */
    removeBraid: {
      mutation: {
        input: Omit<AuthzRemoveBraidInput, "caller" | "actor">;
        output: AuthzBraidRemoved;
      };
    };
    /** Whether only organisation admins may braid; any member reads it. */
    getBraidsPolicy: { query: { input: OrganizationScope; output: AuthzOrganizationPolicy } };
    setBraidsPolicy: {
      mutation: {
        input: OrganizationScope & { braidsOrganizationAdminsOnly: boolean };
        output: AuthzOrganizationPolicy;
      };
    };
    /** Every live braid in the organisation, for its admins. */
    listOrganizationBraids: {
      query: { input: OrganizationScope; output: AuthzOrganizationBraids };
    };
    /** The braid dialog's writes; Enterprise, and refused by code (`braid_*`). */
    createBraid: {
      mutation: { input: Omit<AuthzCreateBraidInput, "caller" | "actor">; output: AuthzBraid };
    };
    changeBraid: {
      mutation: { input: Omit<AuthzChangeBraidInput, "caller" | "actor">; output: AuthzBraid };
    };
    /** The picker: of the projects named, those the viewer may braid into or why not. */
    listBraidTargets: {
      query: { input: { projectId: string; projectIds: string[] }; output: AuthzBraidTargets };
    };
    /** How many people can read the reader's traces; a floor when not `exact`. */
    countProjectTraceViewers: {
      query: { input: { projectId: string }; output: AuthzProjectMembersHolding };
    };
  };

  /** Whether the reader signs its calls, which the only-signed-calls switch names. */
  signingKeys: {
    projectSigning: {
      query: {
        input: { projectId: string };
        output: { keyName: string; lastUsedAt: string | null } | null;
      };
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

    getScopeGraph: {
      query: {
        input: Record<string, never>;
        output: {
          id: string;
          name: string;
          teams: {
            id: string;
            name: string;
            projects: { id: string; slug: string; name: string }[];
          }[];
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
