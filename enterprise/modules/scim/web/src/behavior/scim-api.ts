/**
 * `scimToken` is load-bearing in React Query cache keys. List returns metadata;
 * generate returns plaintext once. This is the sole ADR-004 exception.
 */

import type { scimTokenTrpc } from "@langwatch/enterprise-scim-contract";
import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";

/** One bearer token, as the table renders it: metadata, never the secret. */
export type ScimTokenRow = {
  id: string;
  description: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
};

export type ScimApiMap = ContractApiMap<typeof scimTokenTrpc>;

/**
 * The SCIM family's typed tRPC hooks. Same machinery, same transport and same
 * React Query cache as the application's `api` proxy.
 */
export const scimApi = createModuleApi<ScimApiMap>();
