/**
 * Auth's data steps over its own `Account` rows (the `migration-data-step` skill). Each method is
 * one step's SQL: it names every column it touches.
 */
export abstract class AuthMigrationRepository {
  /**
   * Nulls the provider access, refresh and ID tokens every `Account` row still holds, and answers
   * how many rows it cleared (or would, on a dry run). `updatedAt` is left as it is: identity's
   * secret heal reads a newer `Account` row as drift and copies it over the credential. A second
   * run finds nothing.
   */
  abstract discardProviderTokens(args: { dryRun: boolean }): Promise<number>;
}
