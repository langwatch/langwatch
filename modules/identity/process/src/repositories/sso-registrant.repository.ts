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
}
