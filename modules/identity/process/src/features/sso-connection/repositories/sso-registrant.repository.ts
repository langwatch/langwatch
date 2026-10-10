/**
 * The two questions the sign-in gate asks about a PERSON rather than a
 * connection, over identity's own rows. Membership is not asked here: the
 * organization module owns those rows and answers them (ADR-129).
 */
export abstract class SsoRegistrantReadRepository {
  /**
   * Whether this address is this person's, in either place one can live: the
   * legacy `User.email` copy, or an `Identifier` they still hold (ADR-101
   * §5). Asking one alone admits some administrators and not others.
   */
  abstract holdsAddress(args: { userId: string; email: string }): Promise<boolean>;

  /**
   * Who this exact connection subject is already bound to. Empty for a
   * subject nothing carries; the store's own key keeps it at one.
   */
  abstract findAccountHolderIds(args: {
    connectionId: string;
    accountId: string;
  }): Promise<string[]>;

  // The user resolver's questions; addresses match case-insensitively.

  /** At most two: a second is a case-twin, which refuses the link. */
  abstract findUsersByEmail(args: { email: string }): Promise<SsoResolutionCandidate[]>;

  /** Who holds this connection's exact (issuer, subject) binding. */
  abstract findBindingHolderIds(args: {
    connectionId: string;
    accountKey: SsoAccountKey;
  }): Promise<string[]>;

  /** The person's own accounts, and any account carrying this subject. */
  abstract findAccountsForUserOrSubject(args: {
    userId: string;
    accountKey: SsoAccountKey;
  }): Promise<SsoResolutionAccount[]>;

  /** Whether anybody else holds a live identifier for the address or the subject. */
  abstract isAddressOrSubjectHeldByAnother(args: {
    userId: string;
    email: string;
    accountKey: SsoAccountKey;
  }): Promise<boolean>;

  /** Whether the person holds a password or a passkey. */
  abstract hasStoredCredential(args: { userId: string }): Promise<boolean>;

  /** Whether a live identifier proves a way in for the person, address or subject;
   *  the bare email identifier a directory push attaches proves none. */
  abstract hasProvingIdentifier(args: {
    userId: string;
    email: string;
    accountKey: SsoAccountKey;
  }): Promise<boolean>;
}

/** A person an asserted address already names, as the user resolver weighs them. */
export interface SsoResolutionCandidate {
  id: string;
  emailVerified: boolean;
  deactivated: boolean;
}

/** One federated account row, keyed the way the sign-in library looks it up. */
export interface SsoResolutionAccount {
  userId: string;
  provider: string;
  issuer: string | null;
  providerAccountId: string;
}

/** The subject an assertion carries: better-auth's account key. */
export type SsoAccountKey = Readonly<{ issuer: string; accountId: string }>;
