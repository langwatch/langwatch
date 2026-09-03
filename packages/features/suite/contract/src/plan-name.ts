/**
 * The name a run plan takes, and how long it may be.
 *
 * A run plan is identified by its NAME, so a caller that sends none still
 * needs one. The rule is the run dialog's: what the run covers, then the
 * targets it goes against, "Refunds dev-agent vs prod-agent". A run started
 * from the command line and one started from the dialog over the same scope
 * and targets therefore land on one plan.
 *
 * Framework-free on purpose: the dialog builds the same string in the
 * browser, so nothing here may reach for the database or the request.
 *
 * @see specs/suites/run-plan-identity-by-name.feature
 */

/**
 * How long a run plan name may be. Long enough for a derived
 * `<scope> <target> vs <target>` name, short enough to stay a name.
 */
export const MAX_PLAN_NAME_LENGTH = 200;

/**
 * The derived run name: the scope, then the targets it goes against.
 *
 * A run with no target chosen yet is named after its scope alone. The result
 * is cut to {@link MAX_PLAN_NAME_LENGTH}, which is what the API accepts, so a
 * run against many targets is never refused for a name it did not type.
 */
export function derivePlanName({
  scopeLabel,
  targetLabels,
}: {
  scopeLabel: string;
  targetLabels: readonly string[];
}): string {
  const targets = targetLabels.filter((label) => label.length > 0);
  const name = targets.length === 0 ? scopeLabel : `${scopeLabel} ${targets.join(" vs ")}`;
  return name.trim().slice(0, MAX_PLAN_NAME_LENGTH);
}

/**
 * The key two names are the same under: trimmed, without case.
 *
 * One definition, so the lookup that matches a plan by name and the lock that
 * keeps two runs from creating that plan twice agree on what "the same name"
 * means.
 */
export function planNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Prefix for the advisory-lock key `findOrCreatePlanByName` takes, combined
 * with the project id and `planNameKey(name)`. One definition so the lock and
 * the match agree on what "the same name" means during a rolling deploy.
 */
export const PLAN_NAME_LOCK_PREFIX = "run-plan-name:";
