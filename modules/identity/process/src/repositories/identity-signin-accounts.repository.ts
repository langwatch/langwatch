import type { AccountSignInMethods } from "@langwatch/identity-contract";

/**
 * The legacy sign-in answer for an address whose D01 migration has not
 * latched. Method PRESENCE only: no credential material crosses here, and
 * the subjects that do are opaque identifiers.
 */
export interface LegacySignInAccount {
  userId: string;
  methods: AccountSignInMethods;
  /** The Auth0 subjects among this user's `Account` rows, verbatim. Empty
   *  where the user holds none. */
  auth0Subjects: readonly string[];
}

/**
 * Who holds an address on the LEGACY branch (ADR-116 §6). An array because
 * the address is matched case-insensitively and a case-twin is two rows
 * answering for one person; empty is "nobody holds it".
 */
export abstract class IdentitySignInAccountsRepository {
  abstract findLegacySignInAccounts(args: {
    normalizedValue: string;
  }): Promise<LegacySignInAccount[]>;
}
