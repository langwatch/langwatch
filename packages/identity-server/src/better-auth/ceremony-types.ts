/** The effect seams the ceremonies share, composed once in the app. */
export interface IdentityCeremonyClock {
  now: () => number;
  newCommandId: () => string;
}

/** The `Account` fields a ceremony reads. Structural on purpose: this
 *  package should not track better-auth's row type version to version. */
export interface CeremonyAccountRow {
  id?: unknown;
  userId?: unknown;
  providerId?: unknown;
  accountId?: unknown;
  createdAt?: unknown;
}

/**
 * What the identity storage adapter needs a ceremony to do, as a named
 * contract rather than a `Pick<IdentityCeremonies, …>` (the reason
 * `identity-writes.ts` gives for every other role slice).
 *
 * The adapter's `account` writes are the same two ceremonies better-auth's
 * `databaseHooks` bind, reached one layer lower: ADR-116 §5 moves the fact
 * from a hook-level veto to a storage-level one for latched users. Both
 * callers can run in the same request during the bridge phase, and that is
 * safe because the guards are idempotent — an attach the heads already
 * carry states nothing, and so does a detach of a tombstone.
 */
export interface IdentityAccountCeremonies {
  beforeAccountCreate(
    account: CeremonyAccountRow,
  ): Promise<{ data: { id: string } } | undefined>;
  beforeAccountDelete(account: CeremonyAccountRow): Promise<void>;
  /**
   * A `user` update that touches `email`, on the identity branch (ADR-116
   * §6): stated as a command the guards evaluate, never written as a column.
   *
   * `User.email` gets ONE writer for a latched user — the fold, from their
   * PRIMARY identifier. Letting better-auth's own `changeEmail` /
   * `updateUser` write the column as well is the second-writer hole this
   * closes: the two would disagree the moment a primary switch or a
   * verification landed, and the column is what every other feature reads.
   *
   * So the address becomes an identifier ATTACHED to the user, and the rest
   * of the state machine takes it from there: verify proves the mailbox,
   * primary makes it the one `User.email` shows. Which also means the guard
   * gets its say — an address another user already holds is refused by name
   * rather than by a unique-constraint failure inside the fold.
   */
  beforeEmailChange(args: { userId: string; email: string }): Promise<void>;
}
