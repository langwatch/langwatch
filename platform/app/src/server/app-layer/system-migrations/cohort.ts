/**
 * Who migrates when (specs/migration/system-migrations-runner.feature).
 *
 * The environment knobs are gone. `SYSTEM_MIGRATIONS_COHORT` and
 * `AUTHZ_CUTOVER_COHORT` used to pace the rollout as process-env strings
 * (`none` / `all` / a CSV of organization ids); both are now ignored - the
 * pass logs a warning when either is still set - and pacing lives in two
 * places instead:
 *
 * CLOUD is paced per organization AND per migration, at runtime, by
 * ENROLLMENT: rows an operator writes from the ops migrations page
 * (`SystemMigrationEnrollment`, one row per organization and migration). A
 * (organization, migration) pair nobody enrolled is simply not processed -
 * no state is recorded for it, so "not enrolled yet" and "not started" are
 * the same pending state, which is what lets the rollout widen later. Each
 * migration paces independently of the others.
 *
 * A migration declares its way OUT of that, once, with
 * `enrolledAutomatically`. Enrollment paces a rollout while it is happening;
 * a finished rollout has a different problem - every organization created
 * since must migrate too, and nothing should depend on an operator
 * remembering to enroll it. So a migration that declares
 * `enrolledAutomatically` admits every cloud organization with no row and no
 * operator action, and enrollment rows for it decide nothing. The
 * declaration is per migration precisely because the two states coexist: the
 * authorization-engine migration is finished and automatic while the
 * identity migrations are still soaking behind enrollment.
 *
 * A private data plane changes nothing here, and the routing is the reason:
 * every migration on this axis is ORGANIZATION-rooted, and the event store
 * places an organization-rooted append on that organization's own ClickHouse
 * instance when one is configured, refusing to fall back to the shared
 * client rather than leaking. Leaving those organizations out would strand
 * them on their legacy path forever - the very drift an automatic cohort
 * exists to end.
 *
 * The USER-rooted cohort places its events too, and a USER is a tenant kind
 * in its own right for that purpose - not a project, not an organization,
 * and not resolved into either, because a tenant is a PROJECT id and one
 * user reaches many projects across many organizations with no single one of
 * them to call theirs. Identity history is platform-level, so it lands on the
 * shared instance.
 *
 * What `userMigrationPassCohort` still excludes, there and only there, is a
 * private-dataplane MEMBER. That is a residency rule rather than a routing
 * gap: their identity events would land in the shared platform log while
 * their organization's own data stays on its private instance, and no
 * instance is the right answer for somebody who spans both. The resolver
 * refuses that case on its own account, so the exclusion is a backstop
 * rather than the only thing standing between us and a leak.
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
 * Whether one organization is in this pass's cohort for one migration.
 *
 * Self-hosted includes everything (which migrations run there is
 * `migrationRunsOnThisInstallation`'s question, not this one's). On cloud an
 * enrollment row admits the organization, read fresh at the start of every
 * pass; failing that, the migration's own `enrolledAutomatically`
 * declaration does.
 *
 * A private data plane is deliberately not asked about: the routing already
 * places an organization-rooted append on that organization's own instance
 * (see the module doc). The user-rooted cohort is the one that has to ask.
 */
export function organizationMigrates({
  isSaaS,
  enrolledAutomatically,
  enrolled,
}: {
  isSaaS: boolean;
  enrolledAutomatically: boolean;
  enrolled: boolean;
}): boolean {
  if (!isSaaS) return true;
  return enrolled || enrolledAutomatically;
}

/**
 * Whether this installation's runner drives a migration at all. Cloud runs
 * every registered migration (for whichever organizations `organizationMigrates`
 * admits - this declaration is self-hosted pacing and changes nothing on
 * cloud); self-hosted runs only the migrations already released for
 * self-hosting.
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
