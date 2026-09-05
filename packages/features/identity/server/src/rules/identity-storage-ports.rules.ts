/**
 * Two ports, because they answer two different questions.
 * The storage the identity branch of the adapter runs on (ADR-116 §1, §6).
 */

/**
 * better-auth's `account` model as identity serves it: the identifier says WHO holds the sign-in
 * method, the credential row says what secrets it carries.
 * simply the account-model id after it is dropped (ADR-116 §6). `accountId`
 */
export interface IdentityAccountRow {
  id: string;
  userId: string;
  providerId: string;
  /**
   * better-auth 1.7's account key half: WHO asserted `accountId` below.
   */
  issuer?: string | null;
  accountId: string;
  password: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  scope: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The secret set a write may carry. A field the patch does not name is
 *  left alone; `null` clears it. */
export type IdentityAccountSecrets = Partial<
  Pick<
    IdentityAccountRow,
    | "password"
    | "accessToken"
    | "refreshToken"
    | "idToken"
    | "accessTokenExpiresAt"
    | "refreshTokenExpiresAt"
    | "scope"
  >
>;

export interface IdentityAccountsPort {
  /** The user's live sign-in methods — the account-list read. */
  findByUser(args: { userId: string }): Promise<IdentityAccountRow[]>;
  /** By pinned account id — the id better-auth already holds for a row. */
  findByAccountIds(args: { accountIds: readonly string[] }): Promise<IdentityAccountRow[]>;
  /**
   * The IdP callback's lookup, once resolution has named the user.
   */
  tryFindByProviderSubject(args: {
    userId: string;
    providerId: string;
    providerAccountId: string;
  }): Promise<IdentityAccountRow | null>;
  /**
   * The secrets of an account whose identifier the ceremony has attached. Idempotent on the pinned
   * id: a retried sign-up derives the same identifier and therefore the same row, and must not
   * overwrite secrets the first attempt already stored.
   */
  createCredential(args: {
    accountId: string;
    userId: string;
    /** better-auth's own provider id, stored verbatim (see above). */
    providerId: string;
    secrets: IdentityAccountSecrets;
  }): Promise<void>;
  /** A token refresh or a password change — never an event. */
  updateCredentials(args: {
    accountIds: readonly string[];
    secrets: IdentityAccountSecrets;
  }): Promise<void>;
  deleteCredentials(args: { accountIds: readonly string[] }): Promise<number>;
  /**
   * values written onto the `Account` row the fold maintains, so a gate outage that falls this user
   * back to the legacy branch still verifies their newest password.
   * The forward leg of the bridge mirror (ADR-116 §4): the same secret
   */
  mirrorSecretsOntoAccounts(args: {
    accountIds: readonly string[];
    secrets: IdentityAccountSecrets;
  }): Promise<void>;
  /**
   * The fold removes an unlinked identifier's `Account` row too, and this is not a second writer
   * racing it: the mirror has been keeping that row's secret columns current,
   * The mirrored rows, removed with the method they mirror (ADR-116 §8).
   */
  deleteBridgeAccounts(args: { accountIds: readonly string[] }): Promise<number>;
}

/** A user the identity tables can name, with the one status that lets the
 *  identity branch answer for them. */
export interface IdentityResolution {
  userId: string;
  finalized: boolean;
}

/**
 * AND reads the user's migration-state row in the same Postgres query, so resolution never depends
 * on the write gate's TTL cache — the cache earns its keep on write routing,
 * The reads that carry no `userId` (ADR-116 §2). Each resolves an identifier
 */
export interface IdentityResolutionPort {
  /** Sign-in by any verified email. The value arrives D01-normalized. */
  tryResolveByIdentifierValue(args: {
    normalizedValue: string;
  }): Promise<IdentityResolution | null>;
  /**
   * The OAuth callback's lookup, on the pair `Account` is unique by: better-auth's own provider id,
   * verbatim, and the provider's subject.
   */
  tryResolveByProviderSubject(args: {
    providerId: string;
    providerAccountId: string;
  }): Promise<IdentityResolution | null>;
}
