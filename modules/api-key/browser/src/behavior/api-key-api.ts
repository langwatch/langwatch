/**
 * The procedures this package calls, `apiKey` derived from the contract
 * (the borrowed ones await their own). Segment names are load-bearing
 * (cache key); no read below carries key material — see ADR-001.
 */

import type { apiKeyTrpc } from "@langwatch/api-key-contract";
import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type { AuthzOwnStanding, AuthzOwnStandingInput } from "@langwatch/authz-contract";
import type { projectTrpc } from "@langwatch/project-contract";

/**
 * Procedures other features own. Each belongs in that feature's own contract;
 * until it is split, this family states the shape it reads.
 */
type BorrowedProcedures = {
  organization: {
    /**
     * The organization graph, asked with the shell's own input — same
     * tRPC path-plus-input cache key, so it's fetched once per document.
     * Read for the CLI picker; invalidated after a key rotation.
     */
    getAll: { query: { input: { isDemo?: boolean }; output: unknown } };
  };

  authz: {
    /** The reader's own permissions at a scope, resolved by the server (custom roles too). */
    effectivePermissions: {
      query: { input: AuthzOwnStandingInput; output: AuthzOwnStanding };
    };
  };
};

/** Everything this family calls: its own namespace, the project contract, and the borrowed ones. */
export type ApiKeyApiMap = ContractApiMap<typeof apiKeyTrpc> &
  ContractApiMap<typeof projectTrpc> &
  BorrowedProcedures;

/**
 * The API Key family's typed tRPC hooks, sharing machinery, transport and
 * cache with the application's `api` proxy (see `createModuleApi` for why).
 * INTERNAL by convention: screens call it; the shell mounts the Provider.
 */
export const apiKeyApi = createModuleApi<ApiKeyApiMap>();
