/** An ops-held migration's legacy name, and the step id its owner now declares it under. */
export type MovedTenantSteps = Readonly<Record<string, string>>;

/**
 * Ops' migration steps over its own `SystemMigrationTenantState`. Each method is one blocking
 * step's frozen SQL (migrations-rethink 6.5): it names every column and is never edited once
 * released.
 */
export abstract class OpsMigrationRepository {
  /**
   * Copies, never moves, each moved migration's `finalized` and `rolled_back` tenants into the
   * framework's tenant step state under the new step id (S6-COPY); a row already there is kept.
   * Answers how many it copied, or would copy on a dry run.
   */
  abstract copyTenantState(args: { moves: MovedTenantSteps; dryRun: boolean }): Promise<number>;
}
