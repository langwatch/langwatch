/** An ops-held migration's legacy name, and the step id its owner now declares it under. */
export type MovedTenantSteps = Readonly<Record<string, string>>;

/**
 * Ops' migration steps over its own `SystemMigrationTenantState`. Each method is one step's SQL
 * (migrations-rethink 6.5): it names every column and is never edited once released.
 */
export abstract class OpsMigrationRepository {
  /**
   * Copies, never moves, each moved migration's `finalized` and `rolled_back` tenants into the
   * framework's tenant step state under the new step id (S6-COPY); a row already there is kept.
   * Answers how many it copied, or would copy on a dry run.
   */
  abstract copyTenantState(args: { moves: MovedTenantSteps; dryRun: boolean }): Promise<number>;

  /**
   * Copies, never moves, each moved migration's enrolments to the new step id (S6-ENROLMENTS); an
   * enrolment already there is kept. Answers how many it copied, or would copy on a dry run.
   */
  abstract copyEnrolments(args: { moves: MovedTenantSteps; dryRun: boolean }): Promise<number>;

  /**
   * Withdraws each moved step's enrolment whose old-name twin is gone, once no older image writes
   * them: a withdrawal made on the older page during the rollout. The new page writes both names,
   * so every other enrolment keeps its twin. Answers how many it withdrew, or would.
   */
  abstract withdrawEnrolmentsAfterRollout(args: {
    moves: MovedTenantSteps;
    dryRun: boolean;
  }): Promise<number>;

  /**
   * Copies, never moves, each moved migration's rows that changed after the step's copy, once no
   * older image writes them: a row the step has not reached yet, or one whose own row moved
   * earlier, takes the older table's state; a rolled-back pin there is kept. Answers how many.
   */
  abstract recopyTenantStateAfterRollout(args: {
    moves: MovedTenantSteps;
    dryRun: boolean;
  }): Promise<number>;
}
