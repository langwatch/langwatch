import type {
  JoinRequestCommand,
  JoinRequestFact,
  JoinRequestFactInput,
} from "@langwatch/identity-contract";

/**
 * Where a join request's facts land (D12).
 * (ADR-110): the command staged onto the per-request GroupQueue, whose queued
 */
export interface JoinRequestLedger {
  commit(args: {
    command: JoinRequestCommand;
    facts: JoinRequestFactInput[];
  }): Promise<JoinRequestFact[]>;
}
