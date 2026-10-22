/**
 * Identity's migration steps over its own per-user migration state (D01, Alex 2026-10-06).
 * Each method is one blocking step's frozen SQL (dev/docs/plans/migrations-rethink-2026-10-06.md
 * 6.5): it names every column and is never edited once released.
 */
export abstract class IdentityMigrationRepository {
  /**
   * Flips every identifier-backfill `finalized` row whose account nobody has proven to
   * `migrated`, and answers how many it flipped (or would, on a dry run). A state flip, so a
   * second run finds nothing; `rolled_back` and every other status are never touched.
   */
  abstract reopenUnprovenAccounts(args: { dryRun: boolean }): Promise<number>;

  /**
   * Copies the identifier-backfill state rows into identity's own sign-in switch where the switch
   * has no row or an older one: finalized is on, rolled back is pinned off, any newer row is
   * copied as it reads. Answers how many it copied (or would, on a dry run).
   */
  abstract carryOverSignInSwitch(args: { dryRun: boolean }): Promise<number>;

  /**
   * Nulls the provider access, refresh and ID tokens every `AccountCredential` row still holds,
   * and answers how many rows it cleared (or would, on a dry run). `updatedAt` is left as it is,
   * so the secret heal's comparison with the `Account` row is unchanged. A second run finds
   * nothing.
   */
  abstract discardProviderTokens(args: { dryRun: boolean }): Promise<number>;
}
