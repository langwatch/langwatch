import type { IdentityCommand } from "@langwatch/identity-contract";
import type { IdentityEvent } from "../projections/identity-state.projection";

/**
 * The two ledger legs the born-finalized entrance sequences its own
 * transaction between (ADR-116 §3).
 *
 * Deliberately not `IdentityLedger`: that interface's `commit` is stage-then-
 * wait in one call, which is right for every ceremony whose user already
 * exists. Here the row writes sit in the MIDDLE, so the entrance holds the two
 * legs separately and the eventing writer implements both.
 */
export abstract class IdentityBirthLedgerPort {
  /** Hand the command to the engine. Refusing here fails the sign-up. */
  abstract stage(input: { command: IdentityCommand }): Promise<void>;

  /** Wait, bounded, for the fold to carry these events. An observation. */
  abstract awaitFold(input: {
    userId: string;
    tenantId: string;
    events: IdentityEvent[];
  }): Promise<void>;
}
