import type { IdentifierProvider } from "@langwatch/identity-contract";

/**
 * The storage the identity branch of the adapter runs on (ADR-116 §1, §6).
 *
 * Two ports, because they answer two different questions. `IdentityAccountsPort`
 * serves rows for a user who is already known; `IdentityResolutionPort` answers
 * "who is this?" for a read that names no user, and answers it together with
 * the migration state that decides whether identity may answer at all.
 *
 * Neither port learns better-auth's field mapping: they speak better-auth's
 * CANONICAL account fields, and the adapter maps those onto whatever columns
 * the application's own better-auth configuration says they live in.
 */

/**
 * better-auth's `account` model as identity serves it: the identifier says
 * WHO holds the sign-in method, the credential row says what secrets it
 * carries.
 *
 * `id` is `Identifier.accountId` — the account id pinned at attach, which
 * doubles as the `Account` row's id while the bridge table exists and is
 * simply the account-model id after it is dropped (ADR-116 §6). `accountId`
 * is better-auth's name for the PROVIDER's subject, not for a row id;
 * getting those two the wrong way round is the most likely mistake here.
 *
 * `providerId` is better-auth's own provider id, verbatim, and it is the
 * credential row that carries it. `Identifier.provider` cannot: the
 * identifier vocabulary folds every generic OAuth and enterprise IdP into
 * `oidc` (`identifierProviderFor`), so presenting it back to better-auth
 * would turn an `auth0` account into an `oidc` one and no configured
 * provider would match it again.
 */
export interface IdentityAccountRow {
  id: string;
  userId: string;
  providerId: string;
  /**
   * better-auth 1.7's account key half: WHO asserted `accountId` below.
   *
   * Stored, because it cannot be derived. better-auth synthesises an issuer
   * for a provider that declares none (`local:credential`,
   * `local:oauth:<id>`), but a real OIDC connection brings its own URL and
   * so does Google — so the attach states whatever better-auth decided and
   * the identifier keeps it. Optional only for a row attached before the
   * fact carried one, where the adapter falls back to the synthetic form.
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
  findByAccountIds(args: {
    accountIds: readonly string[];
  }): Promise<IdentityAccountRow[]>;
  /**
   * The IdP callback's lookup, once resolution has named the user.
   *
   * Keyed on the VERBATIM `providerId`, never on the folded `provider`:
   * auth0, okta and every custom OIDC connection collapse into `oidc`, so
   * matching on the fold would let one enterprise IdP's subject answer for
   * another's. `Account` is unique on exactly this pair, and the identity
   * branch has to namespace the same way.
   */
  findByProviderSubject(args: {
    userId: string;
    providerId: string;
    providerAccountId: string;
  }): Promise<IdentityAccountRow | null>;
  /**
   * The secrets of an account whose identifier the ceremony has attached.
   * Idempotent on the pinned id: a retried sign-up derives the same
   * identifier and therefore the same row, and must not overwrite secrets
   * the first attempt already stored.
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
   * The forward leg of the bridge mirror (ADR-116 §4): the same secret
   * values written onto the `Account` row the fold maintains, so a gate
   * outage that falls this user back to the legacy branch still verifies
   * their newest password. Deleted with the table in Phase 3; the reverse
   * leg belongs to the heal pass, not to the adapter.
   */
  mirrorSecretsOntoAccounts(args: {
    accountIds: readonly string[];
    secrets: IdentityAccountSecrets;
  }): Promise<void>;
  /**
   * The mirrored rows, removed with the method they mirror (ADR-116 §8).
   *
   * The fold removes an unlinked identifier's `Account` row too, and this is
   * not a second writer racing it: the mirror has been keeping that row's
   * secret columns current, so between the unlink and the fold it is a live
   * credential for a sign-in method the customer just removed. Deleted with
   * the table in Phase 3, like the mirror itself.
   */
  deleteBridgeAccounts(args: {
    accountIds: readonly string[];
  }): Promise<number>;
}

/** A user the identity tables can name, with the one status that lets the
 *  identity branch answer for them. */
export interface IdentityResolution {
  userId: string;
  finalized: boolean;
}

/**
 * The reads that carry no `userId` (ADR-116 §2). Each resolves an identifier
 * AND reads the user's migration-state row in the same Postgres query, so
 * resolution never depends on the write gate's TTL cache — the cache earns
 * its keep on write routing, where a stale answer costs an event rather than
 * a sign-in.
 */
export interface IdentityResolutionPort {
  /** Sign-in by any verified email. The value arrives D01-normalized. */
  resolveByIdentifierValue(args: {
    normalizedValue: string;
  }): Promise<IdentityResolution | null>;
  /**
   * The OAuth callback's lookup, on the pair `Account` is unique by:
   * better-auth's own provider id, verbatim, and the provider's subject.
   * The folded `provider` vocabulary must never be the match key here -
   * two enterprise IdPs both fold to `oidc`, and a subject is unique only
   * WITHIN an issuer.
   */
  resolveByProviderSubject(args: {
    providerId: string;
    providerAccountId: string;
  }): Promise<IdentityResolution | null>;
}
