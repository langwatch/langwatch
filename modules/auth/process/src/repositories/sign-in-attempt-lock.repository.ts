import type { LockoutState } from "@langwatch/auth-contract";
import type { Instant } from "@langwatch/time";

/**
 * The consecutive-failure state for one address (GAC-09). Keyed by a KEYED
 * hash, never the address: without the key this table is every address
 * anybody ever typed. Spec: specs/identity/org-account-lockout.feature.
 */
export interface SignInAttemptLockRepository {
  /**
   * What has happened to this address so far. An address nobody has failed
   * against has the empty state rather than no state — the counter answers
   * for an address with no account exactly as for one with an account.
   */
  findState(input: { identifierHash: string }): Promise<LockoutState>;
  /** Writes the state this attempt produced. Idempotent under a race: two
   *  failures for one address must not both insert. */
  save(input: {
    identifierHash: string;
    state: LockoutState;
    /** Whose account it was, when it was anybody's. */
    userId: string | null;
  }): Promise<void>;
  /** A success or a proved mailbox: the row has stopped meaning anything. */
  deleteByHash(input: { identifierHash: string }): Promise<number>;
  /** An administrator's release, which names a person rather than a hash. */
  deleteForUser(input: { userId: string }): Promise<number>;
  /**
   * The rows that have stopped meaning anything: no longer locked, not held,
   * and untouched since `settledBefore`. Releases nothing — a held row has no
   * date that frees it and a live lock still has time to run.
   */
  deleteSettled(input: { settledBefore: Instant }): Promise<number>;
}
