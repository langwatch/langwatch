import type { IdentityLedgerState } from "../projections/reduceIdentity";

/**
 * The identity pipeline's command surface (ADR-101 §2). Guards run in the
 * command handlers (one module per verb beside this file), before any event
 * exists — the veto-before-write half of the adapter contract — and events
 * are accepted facts the reducer folds without refusing. Every emitted
 * event's `idempotencyKey` is `<commandId>:<index>`, so a retried command
 * dedupes at the event store on read; and every handler emits nothing when
 * the heads already carry the fact it would state, so a retry, a staged
 * re-run or a restating backfill pass normally writes no row at all
 * (PR #7429: a pass states only what the heads do not carry).
 *
 * The read ports below are how guards see current state. On the calling-path
 * dispatch the adapter uses (D01's pinned order: append waited → fold apply
 * on the calling path → staging best-effort), these reads are
 * read-your-writes against Postgres; on the staged path they run under the
 * queue's per-user FIFO, which serializes them against the fold.
 */

export interface IdentityGuardReads {
  /** The per-user HMAC key (`User.userHashKey`); null when not yet minted —
   *  the attach then records a null hash rather than failing the ceremony. */
  getUserHashKey(params: { userId: string }): Promise<string | null>;
  /** An ACTIVE (VERIFIED or PRIMARY) identifier holding this normalized
   *  value, whoever holds it — the cross-user uniqueness guard's read. */
  findActiveIdentifierByValue(params: {
    normalizedValue: string;
  }): Promise<{ userId: string; identifierId: string } | null>;
  /** The user's current identifier state, as the projection knows it. */
  loadIdentityState(params: { userId: string }): Promise<IdentityLedgerState>;
}

export function eventIdempotencyKey({
  commandId,
  index,
}: {
  commandId: string;
  index: number;
}): string {
  return `${commandId}:${index}`;
}
