import type { ScimSyncCommand, ScimSyncFactInput } from "@langwatch/identity-contract";

/**
 * Where a directory sync's facts land (D08). The app implements it
 * (platform/app/src/server/app-layer/identity/scim-sync-ledger.ts) in the
 * shape the identity, grants and connection ledgers already have: the durable
 * append waited, the command staged onto the per-sync GroupQueue, and the
 * fold left to the queue.
 *
 * A verb whose guard states nothing never reaches here.
 */
export interface ScimSyncLedger {
  commit(args: {
    command: ScimSyncCommand;
    facts: ScimSyncFactInput[];
  }): Promise<void>;
}
