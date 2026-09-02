/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as `gateway-api.ts`,
 * `governance-api.ts`, `automation-api.ts`, `ops-api.ts`, `agent-api.ts`,
 * `data-retention-api.ts`, `dataset-api.ts` and `model-provider-api.ts` say of
 * their own maps: the procedures are mounted by the process out of
 * `@langwatch/role-server`, which a web package may not import even for a type,
 * and the router type does not exist until a process instantiates it. Emitting
 * this file from the mounted router is the fix; writing it by hand is the
 * interim, and it is honest because every payload below is declared in
 * `@langwatch/role-contract` or `@langwatch/authz-contract`.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING, and here they say something worth
 * reading: this family's screens are AuthZ's, but its transport is the ROLE
 * feature's. `role` and `roleBinding` are mount points on the root router and
 * tRPC hashes that path into the React Query cache key, so spelling either
 * differently would quietly stop these hooks sharing a cache with the
 * `api.role.*` call sites that have not moved — the members page, the teams
 * page and the group binding editor all read `role.getAll`, and a stale list
 * after a role is created is exactly the bug that would follow.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE'S SCREEN
 * TREE. ADR-004 seals a screen's closure off from `@langwatch/platform-api-client`,
 * and the import below is the only one of it here. Recorded so the finding it
 * raises is a decision rather than a surprise.
 */

import type { AuthzManagedOrganizationBinding, AuthzPermission } from "@langwatch/authz-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";
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
     * One role with its full permission list, read when an editor or the
     * permissions dialog opens.
     *
     * `getAll` already carries `permissions`, and the page still fetched this:
     * the list read is a cache entry several other surfaces share, and opening
     * an editor is the moment to be sure the permissions being edited are the
     * ones on the server rather than the ones in a list that may have gone
     * stale while the page sat open.
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
 * React Query cache as the application's `api` proxy — see `createFeatureApi`
 * for why separate instances still share cache entries.
 *
 * INTERNAL to this package by convention: the screens call it, and the process
 * shell mounts `authzApi.Provider`.
 */
export const authzApi = createFeatureApi<AuthzApiMap>();
