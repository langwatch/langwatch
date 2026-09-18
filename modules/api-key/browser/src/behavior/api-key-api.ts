/**
 * The procedures this package calls, `apiKey` derived from the contract
 * (the borrowed three await their own). Segment names are load-bearing
 * (cache key); no read below carries key material — see ADR-001.
 */

import type { apiKeyTrpc } from "@langwatch/api-key-contract";
import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";

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
     * The organization graph, asked with the shell's own input — same
     * tRPC path-plus-input cache key, so it's fetched once per document.
     * Read for the CLI picker; invalidated after a key rotation.
     */
    getAll: { query: { input: { isDemo?: boolean }; output: unknown } };
  };
};

/** Everything this family calls: the declared namespace plus the borrowed three. */
export type ApiKeyApiMap = ContractApiMap<typeof apiKeyTrpc> & BorrowedProcedures;

/**
 * The API Key family's typed tRPC hooks, sharing machinery, transport and
 * cache with the application's `api` proxy (see `createModuleApi` for why).
 * INTERNAL by convention: screens call it; the shell mounts the Provider.
 */
export const apiKeyApi = createModuleApi<ApiKeyApiMap>();
