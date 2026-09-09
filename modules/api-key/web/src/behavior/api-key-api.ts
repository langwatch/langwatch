/**
 * The procedures this package calls. The `apiKey` namespace is derived from
 * the contract; the borrowed three belong to features that have not split yet.
 * The segment names are load-bearing (tRPC hashes the path into the React
 * Query cache key), and no read below carries key material — see ADR-001.
 */

import type { apiKeyTrpc } from "@langwatch/api-key-contract";
import { createFeatureApi, type ContractApiMap } from "@langwatch/api/web";

/**
 * Procedures other features own. Each belongs in that feature's own contract;
 * until it is split, this family states the shape it reads.
 */
type BorrowedProcedures = {
  project: {
    /**
     * Rotates the LEGACY project base key and hands back the new one, once.
     * The rotation is a single atomic update plus an audit row server-side, so
     * by the time this answers the previous key is already dead.
     */
    regenerateApiKey: {
      mutation: { input: { projectId: string }; output: { apiKey: string } };
    };

    /**
     * Whether the project has ever received a trace. The CLI onboarding watch
     * polls it after an approval so a first-time reader lands on their own
     * session rather than on an empty page.
     */
    getHasFirstMessage: {
      query: { input: { projectId: string }; output: { firstMessage: boolean } };
    };
  };

  organization: {
    /**
     * The organization graph, asked with the same input the application shell
     * asks with — under tRPC's path-plus-input cache key that is the same
     * entry, so the graph is fetched once per document. Read for the CLI
     * project picker; invalidated after a legacy project key rotation.
     */
    getAll: { query: { input: { isDemo?: boolean }; output: unknown } };
  };
};

/** Everything this family calls: the declared namespace plus the borrowed three. */
export type ApiKeyApiMap = ContractApiMap<typeof apiKeyTrpc> & BorrowedProcedures;

/**
 * The API Key family's typed tRPC hooks. Same machinery, same transport and
 * same React Query cache as the application's `api` proxy — see
 * `createFeatureApi` for why separate instances still share cache entries.
 *
 * INTERNAL to this package by convention: the screens call it, and the process
 * shell mounts `apiKeyApi.Provider`.
 */
export const apiKeyApi = createFeatureApi<ApiKeyApiMap>();
