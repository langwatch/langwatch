/** One credential account row, hash included. Never leaves the feature. */
export type UserCredentialAccount = {
  id: string;
  /** The stored bcrypt hash, or null for an account that has no password yet. */
  passwordHash: string | null;
};

/** One linked sign-in method, as the settings list renders it. */
export type UserLinkedAccount = {
  id: string;
  provider: string;
  providerAccountId: string;
};

/** What an unlink did, or why it did nothing. */
export type UnlinkUserAccountOutcome = "unlinked" | "last_account" | "not_found";

/**
 * The `Account` rows a person's sign-in methods live on, as the user feature
 * reads and writes them.
 *
 * A second repository beside {@link UserRepository} rather than more methods on
 * it, and the reason is one column. `Account.password` is the bcrypt hash a
 * credential sign-in is checked against, and the only two operations that may
 * touch it are the comparison and the rotation — both of which live in
 * `UserCredentialService`. Splitting these reads out here is what lets that
 * service be the whole surface: nothing else in the package, and nothing
 * outside it, is handed a reader that returns the hash.
 *
 * Private to the feature server. `private-runtime-export` keeps every
 * `repositories/` module off the package root, so the only way in is the
 * service the adapter builds.
 */
export abstract class UserCredentialRepository {
  /**
   * The credential account this person signs in with, hash included, or null
   * when they hold no credential method at all.
   *
   * The hash is on the return type on purpose and is not a leak: the one
   * caller is the service, which compares it and discards it.
   */
  abstract tryFindCredentialAccount(input: {
    userId: string;
  }): Promise<UserCredentialAccount | null>;

  /** Replaces the stored hash on one credential account row. */
  abstract writePasswordHash(input: { accountId: string; passwordHash: string }): Promise<void>;

  /**
   * The Auth0 DATABASE identity (`auth0|<subject>`), which is the only linked
   * identity whose password the deployment's Auth0 tenant can change. A social
   * identity federated through Auth0 belongs to its upstream provider.
   */
  abstract tryFindAuth0DatabaseAccount(input: {
    userId: string;
  }): Promise<{ providerAccountId: string } | null>;

  /** Every sign-in method the person holds, for the settings list. */
  abstract findLinkedAccounts(input: { userId: string }): Promise<UserLinkedAccount[]>;

  /**
   * Removes one linked method, refusing to remove the last one.
   *
   * The count and the delete run inside ONE serializable transaction. As
   * separate statements two concurrent unlinks — a double-clicked X — could
   * both observe two accounts, both pass the guard and both delete, leaving
   * the person with no way to sign in.
   */
  abstract unlinkAccount(input: {
    userId: string;
    accountId: string;
  }): Promise<UnlinkUserAccountOutcome>;
}
