import type {
  UnlinkUserAccountInput,
  UnlinkUserAccountOutcome,
  UserLinkedAccount,
} from "@langwatch/user-contract";

/** One credential account row, hash included. Never leaves the feature. */
export type UserCredentialAccount = {
  id: string;
  /** The stored bcrypt hash, or null for an account that has no password yet. */
  passwordHash: string | null;
};

/**
 * Account rows for sign-in methods. Separate to restrict hash access to
 * UserCredentialService alone.
 */
export interface UserCredentialRepository {
  /**
   * The credential account this person signs in with, hash included, or
   * null when they hold no credential method — the hash is not a leak: the
   * one caller is the service, which compares it and discards it.
   */
  findCredentialAccount(input: { userId: string }): Promise<UserCredentialAccount | null>;

  /** Replaces the stored hash on one credential account row. */
  writePasswordHash(input: { accountId: string; passwordHash: string }): Promise<void>;

  /**
   * The Auth0 DATABASE identity (`auth0|<subject>`), which is the only linked
   * identity whose password the deployment's Auth0 tenant can change. A social
   * identity federated through Auth0 belongs to its upstream provider.
   */
  findAuth0DatabaseAccount(input: {
    userId: string;
  }): Promise<{ providerAccountId: string } | null>;

  /** Every sign-in method the person holds, for the settings list. */
  findLinkedAccounts(input: { userId: string }): Promise<UserLinkedAccount[]>;

  /**
   * Removes one linked method, refusing to remove the last one. The count
   * and delete run inside ONE serializable transaction — as separate
   * statements, two concurrent unlinks could both pass the guard and delete.
   */
  unlinkAccount(input: UnlinkUserAccountInput): Promise<UnlinkUserAccountOutcome>;
}
