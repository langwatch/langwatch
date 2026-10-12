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
}
