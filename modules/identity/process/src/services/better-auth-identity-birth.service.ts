import { AsyncLocalStorage } from "node:async_hooks";

import type { IdentityUserGate } from "../rules/identity-user-gate.rules.ts";

/**
 * Born finalized: the entrance a flagged sign-up takes (ADR-116 §3).
 */

/** What one request's entrance has borne so far. */
export interface IdentityBirthScope {
  /** Users this request bore on the identity branch. */
  readonly born: Set<string>;
}

/** One scope per process: it belongs to the request, and every instance must see the same one. */
const birthScope = new AsyncLocalStorage<IdentityBirthScope>();

/** The request-scoped entrance a flagged sign-up runs inside. */
export class BetterAuthIdentityBirthService {
  static create(): BetterAuthIdentityBirthService {
    return new BetterAuthIdentityBirthService();
  }

  private constructor() {}

  /**
   * Open the entrance for one request. The caller has already decided the
   * request is flag-listed; this only carries that decision down to storage.
   */
  runWithIdentityBirth<T>(run: () => Promise<T>): Promise<T> {
    return birthScope.run({ born: new Set<string>() }, run);
  }

  /** Whether this request is inside an entrance. */
  isInsideIdentityBirth(): boolean {
    return birthScope.getStore() !== undefined;
  }

  /** A user borne on the identity branch: every later routed write in this
   *  request is theirs to take on the identity branch. */
  recordIdentityBirth({ userId }: { userId: string }): void {
    birthScope.getStore()?.born.add(userId);
  }

  /** Whether this request already bore this user — the gate's answer for a
   *  newborn, which the real gate cannot give until their rows commit. */
  wasBornInThisRequest({ userId }: { userId: string }): boolean {
    return birthScope.getStore()?.born.has(userId) === true;
  }

  /** Whether this request bore ANYONE — the fleet-level question, asked of a
   *  request whose newborn no state row can answer for yet. */
  anyBornInThisRequest(): boolean {
    return (birthScope.getStore()?.born.size ?? 0) > 0;
  }

  /**
   * The per-user gate, plus the answer it cannot give for a user this request just bore.
   */
  birthAwareGate(gate: IdentityUserGate): IdentityUserGate {
    return async ({ userId }) => this.wasBornInThisRequest({ userId }) || gate({ userId });
  }
}
