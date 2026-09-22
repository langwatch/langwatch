/**
 * `scimToken` is load-bearing in React Query cache keys. List returns metadata;
 * generate returns plaintext once. This is the sole ADR-004 exception.
 */

import { createModuleApi, type ContractApiMap, type OutputsFromMap } from "@langwatch/api/web";
import type { scimReconciliationTrpc, scimTokenTrpc } from "@langwatch/enterprise-scim-contract";

/** One bearer token, as the table renders it: metadata, never the secret. */
export type ScimTokenRow = {
  id: string;
  description: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

export type ScimApiMap = ContractApiMap<typeof scimTokenTrpc> &
  ContractApiMap<typeof scimReconciliationTrpc>;

/** One recorded request, as it arrives in the browser: `occurredAt` is an ISO
 *  string here, whatever the contract declares it as on the server. */
export type ScimRequestRow =
  OutputsFromMap<ScimApiMap>["scimReconciliation"]["getRequests"][number];

/**
 * The SCIM family's typed tRPC hooks. Same machinery, same transport and same
 * React Query cache as the application's `api` proxy.
 */
export const scimApi = createModuleApi<ScimApiMap>();
