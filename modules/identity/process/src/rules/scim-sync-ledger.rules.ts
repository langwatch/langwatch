import type { ScimSyncCommand, ScimSyncFactInput } from "@langwatch/identity-contract";

/**
 * Where a directory sync's facts land (D08).
 * (ADR-110): the command staged onto the per-sync GroupQueue, whose queued run
 */
export interface ScimSyncLedger {
  commit(args: { command: ScimSyncCommand; facts: ScimSyncFactInput[] }): Promise<void>;
}
