/**
 * Whether a user's identifier history is in the log and proven (ADR-110's
 * rule, re-tenanted to users). Reads only: the runner's state machine and its
 * compare-and-set live with the runner, not this row.
 */
export abstract class IdentityLatchRepository {
  /** Has ANY user finished the backfill? Cheap short-circuit for the per-user read. */
  abstract hasAnyoneFinalized(): Promise<boolean>;

  /** Whether THIS user's identifiers are the truth about their addresses. */
  abstract isFinalized(args: { userId: string }): Promise<boolean>;
}
