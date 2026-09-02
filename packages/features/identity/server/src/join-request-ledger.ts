import type {
  JoinRequestCommand,
  JoinRequestFact,
  JoinRequestFactInput,
} from "@langwatch/identity-contract";

/**
 * Where a join request's facts land (D12). `JoinRequestLedgerWriter` — in this
 * package's own `adapters/join-request-ledger.adapter.ts` — implements it in
 * exactly the shape the identity, connection and grants ledgers already have:
 * the durable append waited, the command staged onto the per-request
 * GroupQueue, and a bounded read-your-writes wait on the projection's cursor.
 *
 * A verb whose guard states nothing never reaches here.
 */
export interface JoinRequestLedger {
  commit(args: {
    command: JoinRequestCommand;
    facts: JoinRequestFactInput[];
  }): Promise<JoinRequestFact[]>;
}
