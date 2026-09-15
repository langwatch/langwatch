// Run plan name: derived from scope and targets.

// Maximum length for run plan names.
export const MAX_PLAN_NAME_LENGTH = 200;

// Derive run name from scope and targets, capped at MAX_PLAN_NAME_LENGTH.
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
