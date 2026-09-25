/**
 * `scimToken` is load-bearing in React Query cache keys. List returns metadata;
 * generate returns plaintext once. This is the sole ADR-004 exception.
 */

import { createModuleApi, type ContractApiMap, type OutputsFromMap } from "@langwatch/api/web";
import type {
  scimOversightTrpc,
  scimReconciliationTrpc,
  scimTokenTrpc,
} from "@langwatch/enterprise-scim-contract";
import type { groupTrpc, organizationTrpc } from "@langwatch/organization-contract";

/** One bearer token, as the table renders it: metadata, never the secret. */
export type ScimTokenRow = {
  id: string;
  description: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

export type ScimApiMap = ContractApiMap<typeof scimTokenTrpc> &
  ContractApiMap<typeof scimReconciliationTrpc> &
  ContractApiMap<typeof scimOversightTrpc>;

/** One recorded request, as it arrives in the browser: `occurredAt` is an ISO
 *  string here, whatever the contract declares it as on the server. */
export type ScimRequestRow =
  OutputsFromMap<ScimApiMap>["scimReconciliation"]["getRequests"][number];

/** One connection's directory sync, as the panel renders it: words the
 *  server wrote, never a state name or a reason code. */
export type ConnectionReconciliationRow =
  OutputsFromMap<ScimApiMap>["scimReconciliation"]["getAll"]["connections"][number];

/** One line of what the directory did on one connection, in words. */
export type DirectoryActivityRow =
  OutputsFromMap<ScimApiMap>["scimReconciliation"]["getActivity"][number];

/** One membership change the directory itself caused. */
export type DirectoryChangeRow =
  OutputsFromMap<ScimApiMap>["scimReconciliation"]["getAll"]["recentChanges"][number];

/**
 * The SCIM family's typed tRPC hooks. Same machinery, same transport and same
 * React Query cache as the application's `api` proxy.
 */
export const scimApi = createModuleApi<ScimApiMap>();

/** One connection's sync on the back office's cross-customer list. */
export type OversightSyncRow =
  OutputsFromMap<ScimApiMap>["scimOversight"]["getAll"]["syncs"][number];

/**
 * The two organization reads the directory card states its numbers from:
 * which groups the directory sent, and who it did not create. Called through
 * organization's contract, never its browser package.
 */
export type DirectoryMembershipApiMap = ContractApiMap<typeof groupTrpc> &
  ContractApiMap<typeof organizationTrpc>;

export const directoryMembershipApi = createModuleApi<DirectoryMembershipApiMap>();
