/**
 * The GitHub card's tRPC hooks, derived from github's contract. The `github`
 * segment is load-bearing: tRPC hashes it into the cache key.
 */

import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type { githubTrpc } from "@langwatch/github-contract";

export type GithubApiMap = ContractApiMap<typeof githubTrpc>;

/**
 * The GitHub family's typed tRPC hooks. Same machinery, same transport and same
 * React Query cache as the application's `api` proxy — see `createModuleApi`
 * for why separate instances still share cache entries.
 */
export const githubApi = createModuleApi<GithubApiMap>();
