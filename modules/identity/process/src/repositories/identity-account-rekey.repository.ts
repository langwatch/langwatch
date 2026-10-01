/** One key move as the rows take it: the legacy subject, and the issuer and subject it moves to. */
export interface AccountKeyMove {
  legacySubject: string;
  issuer: string;
  accountId: string;
}

export type AccountKeyMoveResult = "rekeyed" | "unchanged";

/**
 * Moves a pre-3.17 Microsoft `Account` row, and the `Identifier` rows seeded from it, onto
 * better-auth 1.7's key in one step. A row already on the new key, or no legacy row, changes
 * nothing. Writes fold-owned columns directly: the exemption is in the Azure AD upgrade spec.
 */
export abstract class IdentityAccountRekeyRepository {
  abstract moveLegacyMicrosoftAccount(move: AccountKeyMove): Promise<AccountKeyMoveResult>;
}
