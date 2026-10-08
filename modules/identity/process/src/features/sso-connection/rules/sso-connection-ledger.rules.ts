import type {
  SsoConnectionCommand,
  SsoConnectionFact,
  SsoConnectionFactInput,
} from "@langwatch/identity-contract";

/**
 * Where a connection's facts land (D04): a durable append, staged onto the
 * per-connection GroupQueue, then a bounded read-your-writes wait on the
 * projection's cursor. A verb whose guard states nothing never reaches here.
 */
export interface SsoConnectionLedger {
  commit(args: {
    command: SsoConnectionCommand;
    facts: SsoConnectionFactInput[];
  }): Promise<SsoConnectionFact[]>;
}
