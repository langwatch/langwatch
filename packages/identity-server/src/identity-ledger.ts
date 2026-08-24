import type {
  IdentityCommand,
  IdentityFact,
  IdentityFactInput,
} from "@langwatch/identity";

/**
 * THE emission seam — the identity analogue of the grants write repository's
 * verbs (ADR-115 §3). By the time a service reaches this port it has taken
 * its reads and run the guards; the ledger is handed the command (what the
 * staged re-run replays) and the facts it produced (what the durable append
 * stores), and returns the facts as committed, with their business time.
 *
 * The app implements it with ADR-101 §2's pinned order — envelope, durable
 * ClickHouse append WAITED, fold apply on the calling path, GroupQueue
 * staging LAST and best-effort
 * (platform/app/src/server/app-layer/identity/ledger.ts). This package never
 * learns there is a queue, a store, or a projection.
 */
export interface IdentityLedger {
  commit(args: {
    command: IdentityCommand;
    facts: IdentityFactInput[];
  }): Promise<IdentityFact[]>;
}
