import type { MfaCommand, MfaFact, MfaFactInput } from "@langwatch/identity";

/**
 * Where a two-step verification fact lands (D06). The app implements it
 * (platform/app/src/server/app-layer/identity/mfa-ledger.ts) in exactly the
 * shape the identity, connection and join-request ledgers already have: the
 * durable append waited, the command staged onto the per-person GroupQueue,
 * and a bounded read-your-writes wait on the projection's cursor.
 *
 * A verb whose guard states nothing never reaches here.
 *
 * Nothing that crosses this interface can carry a secret or a backup code:
 * `MfaFactInput` has no field for one, which is a property of the type rather
 * than a rule somebody has to remember.
 */
export interface MfaLedger {
  commit(args: {
    command: MfaCommand;
    facts: MfaFactInput[];
  }): Promise<MfaFact[]>;
}
