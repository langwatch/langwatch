/**
 * The procedures this package calls, derived from the contract. The `scimToken`
 * segment is load-bearing: tRPC hashes it into the React Query cache key. The
 * plaintext bearer crosses the wire once, from `generate`; `list` answers
 * metadata only. This module is the package's one governed-closure exception to
 * ADR-004: its `@langwatch/api/web` import is the only one in the package.
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
