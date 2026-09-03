import type { ScimSyncCommand, ScimSyncFactInput } from "@langwatch/identity-contract";

/**
 * Where a directory sync's facts land (D08). `ScimSyncLedgerWriter` — in this
 * package's own `adapters/eventing.scim-sync-ledger.adapter.ts` — implements it
 * in the shape the identity, grants and connection ledgers already have
 * (ADR-110): the command staged onto the per-sync GroupQueue, whose queued run
 * is the sole appender, and the fold left to the queue.
 *
 * A verb whose guard states nothing never reaches here.
 */
export interface ScimSyncLedger {
  commit(args: {
    command: ScimSyncCommand;
    facts: ScimSyncFactInput[];
  }): Promise<void>;
}
