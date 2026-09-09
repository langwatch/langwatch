/**
 * The Integrations screen's tRPC hooks. The `github` segment is load-bearing: tRPC
 * hashes it into the React Query cache key. This module is the package's one
 * governed-closure exception to ADR-004: its `@langwatch/api/web` import is the
 * only one in the package.
 */

import type { githubTrpc } from "@langwatch/github-contract";
import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";

export type GithubApiMap = ContractApiMap<typeof githubTrpc>;

/**
 * The GitHub family's typed tRPC hooks. Same machinery, same transport and same
 * React Query cache as the application's `api` proxy — see `createModuleApi`
 * for why separate instances still share cache entries.
 */
export const githubApi = createModuleApi<GithubApiMap>();
