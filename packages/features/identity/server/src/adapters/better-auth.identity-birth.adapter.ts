import { AsyncLocalStorage } from "node:async_hooks";
import type { IdentityUserGate } from "../rules/identity-user-gate.rules";

/**
 * Born finalized: the entrance a flagged sign-up takes (ADR-116 §3).
 */

/** What one request's entrance has borne so far. */
export interface IdentityBirthScope {
  /** Users this request bore on the identity branch. */
  readonly born: Set<string>;
}

/**
 * The request-scoped entrance a flagged sign-up runs inside. Static because the scope is
 * `AsyncLocalStorage`: it belongs to the request, not to an instance, and every collaborator in
 * that request must see the same one.
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
   * The per-user gate, plus the answer it cannot give for a user this request just bore.
   */
  static birthAwareGate(gate: IdentityUserGate): IdentityUserGate {
    return async ({ userId }) =>
      BetterAuthIdentityBirthAdapter.wasBornInThisRequest({ userId }) || gate({ userId });
  }
}
