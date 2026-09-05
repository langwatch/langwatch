import { HandledError } from "@langwatch/handled-error";

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
export abstract class IdentityBirthPort {
  /**
   * Run ADR-116 §3's sequence and answer the `User` row better-auth must be
   * handed back — which carries the PINNED user id, not the one better-auth
   * minted, so every retry of this sign-up converges on one user.
   *
   * Throws rather than falling back. A newborn quietly created on the legacy
   * branch would poison the very rollout the flag exists to test.
   */
  abstract bear(newborn: IdentityNewborn): Promise<Record<string, unknown>>;
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
