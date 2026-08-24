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
}
