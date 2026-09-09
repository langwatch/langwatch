import type {
  SsoConnectionCommand,
  SsoConnectionFact,
  SsoConnectionFactInput,
} from "@langwatch/identity-contract";

/**
 * Where a connection's facts land (D04). The app implements it
 * (platform/app/src/server/app-layer/identity/sso-connection-ledger.ts) in
 * exactly the shape the identity and grants ledgers already have: the
 * durable append waited, the command staged onto the per-connection
 * GroupQueue, and a bounded read-your-writes wait on the projection's
 * cursor.
 *
 * A verb whose guard states nothing never reaches here.
 */
export interface SsoConnectionLedger {
  commit(args: {
    command: SsoConnectionCommand;
    facts: SsoConnectionFactInput[];
  }): Promise<SsoConnectionFact[]>;
}
