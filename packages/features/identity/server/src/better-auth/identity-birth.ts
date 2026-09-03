import { AsyncLocalStorage } from "node:async_hooks";
import { HandledError } from "@langwatch/handled-error";
import type { IdentityUserGate } from "../identity-user-gate";

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

const scope = new AsyncLocalStorage<IdentityBirthScope>();

/**
 * Open the entrance for one request. The caller has already decided the
 * request is flag-listed; this only carries that decision down to storage.
 */
export function runWithIdentityBirth<T>(run: () => Promise<T>): Promise<T> {
  return scope.run({ born: new Set<string>() }, run);
}

/** The entrance, if this request is inside one. */
export function currentIdentityBirth(): IdentityBirthScope | undefined {
  return scope.getStore();
}

/** A user borne on the identity branch: every later routed write in this
 *  request is theirs to take on the identity branch. */
export function recordIdentityBirth({ userId }: { userId: string }): void {
  scope.getStore()?.born.add(userId);
}

/** Whether this request already bore this user — the gate's answer for a
 *  newborn, which the real gate cannot give until their rows commit. */
export function wasBornInThisRequest({ userId }: { userId: string }): boolean {
  return scope.getStore()?.born.has(userId) === true;
}

/** Whether this request bore ANYONE — the fleet-level question, asked of a
 *  request whose newborn no state row can answer for yet. */
export function anyBornInThisRequest(): boolean {
  return (scope.getStore()?.born.size ?? 0) > 0;
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
export function birthAwareGate(gate: IdentityUserGate): IdentityUserGate {
  return async ({ userId }) => wasBornInThisRequest({ userId }) || gate({ userId });
}

/**
 * The newborn as the entrance takes them: better-auth's own canonical user
 * row, plus the two values the identity sequence needs pulled out of it.
 *
 * The row rides through as it arrived rather than as a narrowed shape, so a
 * better-auth version that adds a user field writes it. A field with no
 * column fails the sign-up loudly, which is the right direction for a
 * population that is an allowlist.
 */
export interface IdentityNewborn {
  /** better-auth's canonical `user` row, keys and all. */
  row: Record<string, unknown>;
  /** The address the identifier is derived from, unnormalized. */
  email: string;
  /** Business time for the attach fact — the row's own `createdAt`. */
  createdAtMs: number;
}

/**
 * The entrance itself, as the adapter reaches it. The sequence lives in the
 * application, where the event store, Postgres and the migration-state table
 * are; the adapter only decides that this write is a birth.
 */
export interface IdentityBirthPort {
  /**
   * Run ADR-116 §3's sequence and answer the `User` row better-auth must be
   * handed back — which carries the PINNED user id, not the one better-auth
   * minted, so every retry of this sign-up converges on one user.
   *
   * Throws rather than falling back. A newborn quietly created on the legacy
   * branch would poison the very rollout the flag exists to test.
   */
  bear(newborn: IdentityNewborn): Promise<Record<string, unknown>>;
}

/**
 * The event-sourcing stack could not accept the newborn's facts.
 *
 * This is the coupling ADR-116 §3 re-introduces on purpose and scopes to the
 * allowlist: a flagged sign-up needs the engine, and when the engine is down
 * it FAILS rather than silently taking the legacy branch. Handled, because
 * the caller can act on it — retrying is exactly right, and the sequence is
 * idempotent — and `fault: "platform"` because nothing the customer did
 * caused it and nothing they can do fixes it.
 *
 * The message is customer-safe and says nothing about which component was
 * unavailable; the underlying failure rides in `reasons`, for the log.
 */
export class IdentityEngineUnavailableError extends HandledError {
  constructor(detail: string, cause: unknown) {
    super("identity_engine_unavailable", "identity_engine_unavailable", {
      httpStatus: 503,
      fault: "platform",
      reasons: [new Error(detail), ...(cause instanceof Error ? [cause] : [])],
      tips: ["Try creating the account again in a moment."],
    });
    this.name = "IdentityEngineUnavailableError";
  }
}
