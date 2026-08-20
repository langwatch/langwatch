/**
 * Who migrates when (specs/rbac/in-place-authz-migration.feature).
 *
 * The environment knobs are gone. `SYSTEM_MIGRATIONS_COHORT` and
 * `AUTHZ_CUTOVER_COHORT` used to pace the rollout as process-env strings
 * (`none` / `all` / a CSV of organization ids); both are now ignored - the
 * pass logs a warning when either is still set - and pacing lives in two
 * places instead:
 *
 * CLOUD is paced per organization, at runtime, by ENROLLMENT: rows an
 * operator writes from the ops migrations page (`SystemMigrationEnrollment`,
 * one row per organization and stage). An organization that nobody enrolled
 * is simply not processed - no state is recorded for it, so "not enrolled
 * yet" and "not started" are the same pending state, which is what lets the
 * rollout widen later. The two stages pace independently: "migrations"
 * enrolls the preparation work (backfill + genesis import), "cutover"
 * enrolls the flip onto the engine.
 *
 * SELF-HOSTED is paced per migration, at release time, by the migration's
 * own `runsAutomaticallyOnSelfHosted` declaration. There is no enrollment
 * and no configuration - the in-place doctrine is that an operator never
 * learns a migration happened - so every organization migrates automatically,
 * but only through the migrations already released for self-hosting.
 * A migration still soaking on cloud declares `false` and the self-hosted
 * runner never drives it for any tenant; a later release flips the
 * declaration, and the next pass runs it. The old `none` opt-out died with
 * the env var - the self-hosted lever is the operator rollback, plus the
 * release declaration itself.
 */

/**
 * Whether one organization is in this pass's cohort. On cloud that is its
 * enrollment for the pass's stage, read fresh at the start of every pass;
 * self-hosted includes everything (which migrations run there is
 * `migrationRunsOnThisInstallation`'s question, not this one's).
 */
export function organizationMigrates({
  isSaaS,
  enrolled,
}: {
  isSaaS: boolean;
  enrolled: boolean;
}): boolean {
  return isSaaS ? enrolled : true;
}

/**
 * Whether this installation's runner drives a migration at all. Cloud runs
 * every registered migration (for its enrolled organizations - the
 * declaration is self-hosted pacing and changes nothing on cloud);
 * self-hosted runs only the migrations already released for self-hosting.
 */
export function migrationRunsOnThisInstallation({
  isSaaS,
  runsAutomaticallyOnSelfHosted,
}: {
  isSaaS: boolean;
  runsAutomaticallyOnSelfHosted: boolean;
}): boolean {
  return isSaaS || runsAutomaticallyOnSelfHosted;
}
