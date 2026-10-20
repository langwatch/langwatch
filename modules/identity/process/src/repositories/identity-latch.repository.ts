import type { Instant } from "@langwatch/time";

/**
 * Whether a user's identifier history is in the log and proven (ADR-110's
 * rule, re-tenanted to users). Identity owns its migration's per-tenant state
 * (D01, Alex 2026-10-06): an arrival records `finalized`, and the runner reads it.
 */
export abstract class IdentityLatchRepository {
  /** Has ANY user finished the backfill? Cheap short-circuit for the per-user read. */
  abstract hasAnyoneFinalized(): Promise<boolean>;

  /** Whether THIS user's identifiers are the truth about their addresses. */
  abstract isFinalized(args: { userId: string }): Promise<boolean>;

  /** An arrival adopted this user: `finalized`, unless an operator pinned `rolled_back`. */
  abstract recordFinalized(args: { userId: string; report: unknown }): Promise<void>;

  /**
   * The identifier backfill proved this user: identity's own switch on, unless an operator pinned
   * it off, here or in ops' older row. Answers whether it is on now.
   */
  abstract recordProven(args: { userId: string; at: Instant }): Promise<boolean>;

  /** An operator's rollback: off for good, keeping the fact's id as the row's version. */
  abstract pinSignInSwitch(args: { userId: string; at: Instant; eventId: string }): Promise<void>;
}
