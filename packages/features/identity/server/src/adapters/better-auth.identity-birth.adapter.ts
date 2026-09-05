import { AsyncLocalStorage } from "node:async_hooks";
import type { IdentityUserGate } from "../rules/identity-user-gate.rules";

/**
 * Born finalized: the entrance a flagged sign-up takes (ADR-116 §3).
 *
 * Every other user reaches the identity branch by MIGRATING onto it — their
 * backfill finalizes, the gate opens, and from then on their ceremonies
 * state facts. A newborn has no history to adopt, so the migration that
 * would open their gate has nothing to do; without an entrance they would be
 * created on the legacy branch and then immediately need migrating off it.
 *
 * The entrance closes that gap by writing the newborn's identity history and
 * their `finalized` state row in one sequence, so their FIRST write is
 * already on the identity branch.
 *
 * ## Why a request-scoped marker
 *
 * The write gate cannot answer for a user who does not exist yet. It reads
 * the migration-state row on a separate connection under READ COMMITTED, and
 * its anyone-finalized short-circuit caches `false` fleet-wide for a TTL
 * before the first finalized user exists — so during the very request that
 * creates the newborn, the gate is structurally unable to say yes.
 *
 * The marker is the answer the gate cannot give, scoped to the one request
 * that knows it. It is set at the auth route boundary, and ONLY when the
 * backend feature-flag check passed — the flag is the allowlist, and nothing
 * below this line re-decides it. While it is set, every routed write in the
 * request is the newborn's, which matters because better-auth creates the
 * user and then, in the same request, their credential account.
 *
 * The marker holds the ids of users actually borne, not a bare boolean: the
 * account write that follows has to be routed for THAT user and nobody else,
 * and a request that bore nobody must route nothing.
 */

/** What one request's entrance has borne so far. */
export interface IdentityBirthScope {
  /** Users this request bore on the identity branch. */
  readonly born: Set<string>;
}

/**
 * The request-scoped entrance a flagged sign-up runs inside.
 *
 * Static because the scope is `AsyncLocalStorage`: it belongs to the request,
 * not to an instance, and every collaborator in that request must see the same
 * one.
 */
export class BetterAuthIdentityBirthAdapter {
  static create(): BetterAuthIdentityBirthAdapter {
    return new BetterAuthIdentityBirthAdapter();
  }

  private constructor() {}

  private static readonly scope = new AsyncLocalStorage<IdentityBirthScope>();

  /**
   * Open the entrance for one request. The caller has already decided the
   * request is flag-listed; this only carries that decision down to storage.
   */
  static runWithIdentityBirth<T>(run: () => Promise<T>): Promise<T> {
    return BetterAuthIdentityBirthAdapter.scope.run({ born: new Set<string>() }, run);
  }

  /** The entrance, if this request is inside one. */
  static currentIdentityBirth(): IdentityBirthScope | undefined {
    return BetterAuthIdentityBirthAdapter.scope.getStore();
  }

  /** A user borne on the identity branch: every later routed write in this
   *  request is theirs to take on the identity branch. */
  static recordIdentityBirth({ userId }: { userId: string }): void {
    BetterAuthIdentityBirthAdapter.scope.getStore()?.born.add(userId);
  }

  /** Whether this request already bore this user — the gate's answer for a
   *  newborn, which the real gate cannot give until their rows commit. */
  static wasBornInThisRequest({ userId }: { userId: string }): boolean {
    return BetterAuthIdentityBirthAdapter.scope.getStore()?.born.has(userId) === true;
  }

  /** Whether this request bore ANYONE — the fleet-level question, asked of a
   *  request whose newborn no state row can answer for yet. */
  static anyBornInThisRequest(): boolean {
    return (BetterAuthIdentityBirthAdapter.scope.getStore()?.born.size ?? 0) > 0;
  }

  /**
   * The per-user gate, plus the answer it cannot give for a user this request
   * just bore. ONE implementation, because two collaborators fork on the same
   * question in the same request — the storage adapter and the `databaseHooks`
   * ceremonies — and a newborn whose adapter routed to identity while their
   * ceremony declined would get a legacy `Account` row anyway, which is
   * exactly what the entrance exists to prevent.
   *
   * Outside a marked request this is the gate, unchanged.
   */
  static birthAwareGate(gate: IdentityUserGate): IdentityUserGate {
    return async ({ userId }) =>
      BetterAuthIdentityBirthAdapter.wasBornInThisRequest({ userId }) || gate({ userId });
  }
}
