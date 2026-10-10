/**
 * The organization's own reads of the `User` table: an invited address and the
 * legacy verified-email column.
 */
export abstract class OrganizationUserDirectoryRepository {
  abstract findUserIdByEmail(input: Readonly<{ email: string }>): Promise<string | null>;
  /** The legacy verified-email column, for a user with no identity-ledger entry. */
  abstract findLegacyVerifiedEmail(userId: string): Promise<string | null>;
}
