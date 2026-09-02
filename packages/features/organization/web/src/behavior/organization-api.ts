/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as every other feature
 * family's map says of itself: the procedures are mounted by the process out of
 * `@langwatch/organization-server`, which a web package may not import even for
 * a type, and the router type does not exist until a process instantiates one.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `organization` and `limits` are mount
 * points on the root router and tRPC hashes that path into the React Query
 * cache key; spell either differently and these hooks quietly stop sharing a
 * cache with the `api.organization.*` call sites that have not moved — of which
 * there are many, the application shell's own organization graph among them.
 *
 * `EnrichedAuditLog` IS THE PRODUCER'S OWN TYPE, not a restatement. It is
 * declared in `@langwatch/organization-contract` and `OrganizationApp.getAuditLogs`
 * is annotated with it, so widening what the audit trail answers is a compile
 * error at the producer rather than a silent disclosure at this table.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package.
 */

import type { EnrichedAuditLog } from "@langwatch/organization-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

/**
 * Every filter the audit table narrows by, in the one shape both the table and
 * the CSV export send.
 *
 * The export has to send exactly this: a download taken from a pre-filtered
 * deep-link that silently widened to the whole organization's history would be
 * a disclosure dressed up as a convenience.
 */
export type AuditLogFilters = {
  organizationId: string;
  projectId?: string;
  userId?: string;
  action?: string;
  startDate?: number;
  endDate?: number;
  targetKind?: string;
  targetId?: string;
};

/** One page of the audit trail. */
export type AuditLogPage = {
  auditLogs: EnrichedAuditLog[];
  totalCount: number;
};

/** A member row, as the "search by user" box matches against it. */
export type OrganizationMemberMatch = {
  userId: string;
  user: { id: string; name: string | null; email: string | null };
};

export type OrganizationApiMap = {
  organization: {
    /**
     * One page of the organization's audit trail, newest first.
     *
     * `pageOffset`/`pageSize` are real offset paging — the audit trail is a
     * Prisma read with `skip`, not a keyset walk — which is why the footer this
     * screen renders drives its own offsets rather than carrying a cursor.
     */
    getAuditLogs: {
      query: {
        input: AuditLogFilters & { pageOffset: number; pageSize: number };
        output: AuditLogPage;
      };
    };

    /**
     * The organization graph the application shell already holds.
     *
     * Asked by the FRONTEND FEATURE rather than by the screen — the screen is
     * handed the teams and projects through its host port — and declared here
     * because that feature runs on this package's transport. Same input the
     * shell asks with, so under tRPC's path-plus-input cache key it is the same
     * entry: the graph is fetched once for the document.
     */
    getAll: {
      query: {
        input: { isDemo: boolean };
        output: Array<{
          id: string;
          name: string;
          slug: string;
          teams: Array<{
            id: string;
            name: string;
            projects: Array<{ id: string; name: string; slug: string }>;
          }>;
        }>;
      };
    };

    /**
     * The members the "search by user" box resolves a name or an address into a
     * user id with. The audit read filters by id, so the typing has to be
     * matched in the browser against a list the reader is already allowed to
     * see.
     */
    getOrganizationWithMembersAndTheirTeams: {
      query: {
        input: { organizationId: string };
        output: { members: OrganizationMemberMatch[] };
      };
    };
  };

  limits: {
    /**
     * Which plan the organization is on.
     *
     * The audit trail is an Enterprise capability, and this is the read the
     * page's own gate gets its answer from. Only `activePlan.type` is named:
     * the rest of the usage payload belongs to the billing surfaces.
     */
    getUsage: {
      query: {
        input: { organizationId: string };
        output: { activePlan: { type: string } };
      };
    };
  };
};

/**
 * The organization family's typed tRPC hooks. Same machinery, same transport
 * and same React Query cache as the application's `api` proxy — see
 * `createFeatureApi` for why separate instances still share cache entries.
 */
export const organizationApi = createFeatureApi<OrganizationApiMap>();
