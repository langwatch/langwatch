/**
 * Who migrates when. CLOUD paces per (organization, migration) by
 * ENROLLMENT rows, unless `enrolledAutomatically` (finished rollout).
 * SELF-HOSTED paces per migration at release via `runsAutomaticallyOnSelfHosted`.
 */

/**
 * Whether one organization is in this pass's cohort for one migration.
 * Self-hosted includes everything; on cloud an enrollment row admits it,
 * or the migration's own `enrolledAutomatically` declaration does.
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
 * every registered migration; self-hosted runs only those already released.
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

/**
 * Whether one user is in this pass's cohort for one USER-rooted migration
 * (ADR-101 §6). The ops page enrolls ORGANIZATIONS, so membership of an
 * enrolled one admits a user; automatic enrollment and self-hosted admit all.
 */
export function userMigrates({
  isSaaS,
  enrolledAutomatically,
  memberOfEnrolledOrganization,
}: {
  isSaaS: boolean;
  enrolledAutomatically: boolean;
  memberOfEnrolledOrganization: boolean;
}): boolean {
  if (!isSaaS) return true;
  return enrolledAutomatically || memberOfEnrolledOrganization;
}
