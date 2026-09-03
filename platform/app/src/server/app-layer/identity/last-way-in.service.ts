import { isUsableCredential } from "../../users/credential-user";

/**
 * The rows "would this leave them locked out" is decided from.
 *
 * Both reads name a person and nothing else, because the question is about
 * what SURVIVES a removal rather than about the thing going: a second
 * passkey, a password still set, a federated account still linked.
 */
export interface LastWayInRecordsPort {
  /** How many passkeys this person holds besides the named one. */
  countOtherPasskeys(args: {
    userId: string;
    exceptPasskeyId: string;
  }): Promise<number>;
  /** Every credential row this person holds, as the predicate reads them. */
  findCredentials(args: {
    userId: string;
  }): Promise<readonly { provider: string; password: string | null }[]>;
}

export interface LastWayInServiceDeps {
  records: LastWayInRecordsPort;
}

/**
 * Whether a removal would leave somebody unable to sign in (ADR-119).
 *
 * The detach guard on `account.delete.before` answers this for every removal
 * that goes through better-auth's `account` model. A passkey does not go
 * through it — the plugin owns its own table — so the same question is asked
 * here, from the same side: count what is LEFT, and refuse only when the
 * answer is nothing.
 *
 * The credential predicate is `isUsableCredential`, shared with the sign-up
 * guard that decides whether an address is somebody's. The two answer one
 * question from opposite sides, and a row one of them called a way in the
 * other must too — otherwise an account is both un-adoptable and un-removable.
 */
export class LastWayInService {
  constructor(private readonly deps: LastWayInServiceDeps) {}

  /**
   * Whether removing this passkey would close the last door.
   *
   * Both reads are issued together rather than short-circuited on the passkey
   * count: they are one question asked of one person, and the second read is a
   * handful of rows on a unique index.
   */
  async passkeyRemovalStrandsUser({
    userId,
    passkeyId,
  }: {
    userId: string;
    passkeyId: string;
  }): Promise<boolean> {
    const [otherPasskeys, credentials] = await Promise.all([
      this.deps.records.countOtherPasskeys({
        userId,
        exceptPasskeyId: passkeyId,
      }),
      this.deps.records.findCredentials({ userId }),
    ]);
    if (otherPasskeys > 0) return false;

    return !credentials.some(isUsableCredential);
  }
}
