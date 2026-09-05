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
  /** better-auth 1.7's account key half. Absent on a row written by an
   *  older library version, which is why the ceremony falls back to
   *  deriving it rather than declining to state the attach. */
  issuer?: unknown;
  accountId?: unknown;
  createdAt?: unknown;
}

/**
 * What the identity storage adapter needs a ceremony to do: the same two
 * ceremonies better-auth's hooks bind, reached one layer lower.
 * ADR-116 §5 moves the fact from a hook-level veto to a storage-level one.
 */
export interface IdentityAccountCeremonies {
  tryBeforeAccountCreate(
    account: CeremonyAccountRow,
  ): Promise<{ data: { id: string } } | undefined>;
  beforeAccountDelete(account: CeremonyAccountRow): Promise<void>;
  /**
   * A `user` update that touches `email`, on the identity branch (ADR-116
   */
  beforeEmailChange(args: { userId: string; email: string }): Promise<void>;
}
