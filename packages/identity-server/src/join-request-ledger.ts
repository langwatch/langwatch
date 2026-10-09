import type {
  JoinRequestCommand,
  JoinRequestFact,
  JoinRequestFactInput,
} from "@langwatch/identity";

/**
 * Where a join request's facts land (D12). The app implements it
 * (platform/app/src/server/app-layer/identity/join-request-ledger.ts) in
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
