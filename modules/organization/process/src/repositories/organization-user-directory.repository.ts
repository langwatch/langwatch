/**
 * The organization's own reads of the `User` table: an invited address, the
 * legacy verified-email column, and member display names.
 */
export abstract class OrganizationUserDirectoryRepository {
  abstract findUserIdByEmail(input: Readonly<{ email: string }>): Promise<string | null>;
  /** The legacy verified-email column, for a user with no identity-ledger entry. */
  abstract findLegacyVerifiedEmail(userId: string): Promise<string | null>;
  /** Display names for a page of user ids the organization already vouches for. */
  abstract findUserNames(
    userIds: readonly string[],
  ): Promise<readonly Readonly<{ id: string; name: string | null }>[]>;
}
