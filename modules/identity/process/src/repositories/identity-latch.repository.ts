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
}
