import {
  MAX_RETENTION_DAYS,
  PLATFORM_DEFAULT_RETENTION_DAYS,
  RETENTION_WEEK_DAYS,
} from "@langwatch/data-retention-contract";

/**
 * The only environments allowed to lower the platform retention default.
 * Fail-CLOSED: NODE_ENV comes from operator-supplied Helm values, so "prod",
 * "staging" or unset must not shrink the default by omission.
 */
const NON_PRODUCTION_NODE_ENVS = ["development", "test"] as const;

/**
 * Resolves the retention stamped when no override exists in a tenant's scope
 * cascade. `LANGWATCH_DEFAULT_RETENTION_DAYS` lowers it for a local stack, in
 * whole weeks, and only under a recognised non-production environment.
 */
export function resolvePlatformDefaultRetentionDays(
  source: Readonly<{ LANGWATCH_DEFAULT_RETENTION_DAYS?: string; NODE_ENV?: string }>,
): number {
  const raw = source.LANGWATCH_DEFAULT_RETENTION_DAYS;
  if (raw == null || raw === "") return PLATFORM_DEFAULT_RETENTION_DAYS;

  const nodeEnv = source.NODE_ENV;
  const isKnownNonProduction = NON_PRODUCTION_NODE_ENVS.some((candidate) => candidate === nodeEnv);
  if (!isKnownNonProduction) {
    throw new Error(
      `LANGWATCH_DEFAULT_RETENTION_DAYS must not be set when NODE_ENV=${nodeEnv ?? "(unset)"}: ` +
        `the platform retention default is fixed at ${PLATFORM_DEFAULT_RETENTION_DAYS} days ` +
        "outside development and test, and lowering it would silently expire customer data. " +
        "Configure per-tenant retention through RetentionPolicy overrides instead.",
    );
  }

  const days = Number(raw);
  if (
    !Number.isInteger(days) ||
    days <= 0 ||
    days > MAX_RETENTION_DAYS ||
    days % RETENTION_WEEK_DAYS !== 0
  ) {
    throw new Error(
      `LANGWATCH_DEFAULT_RETENTION_DAYS=${raw} is invalid: it must be a positive whole number of weeks ` +
        `(a multiple of ${RETENTION_WEEK_DAYS}, at most ${MAX_RETENTION_DAYS}) so it aligns with the weekly partition key.`,
    );
  }
  return days;
}
