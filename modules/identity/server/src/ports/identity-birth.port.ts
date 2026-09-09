import { HandledError } from "@langwatch/handled-error";

/**
 * The newborn as the entrance takes them: better-auth's own canonical user row, plus the two
 * values the identity sequence needs pulled out of it. The row rides through as it arrived
 * rather than as a narrowed shape, so a better-auth version that adds a user field writes it.
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
   */
  abstract bear(newborn: IdentityNewborn): Promise<Record<string, unknown>>;
}

/**
 * The event-sourcing stack could not accept the newborn's facts.
 * This is the coupling ADR-116 §3 re-introduces on purpose and scopes to the
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
