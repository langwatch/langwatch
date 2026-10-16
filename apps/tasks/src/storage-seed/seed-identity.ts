/**
 * Pure address-resolution helpers for the local-dev seed (seed.ts), split
 * out for testability without booting Prisma. Unset SEED_EMAIL_DOMAIN
 * keeps one stable address, so a saved password-manager login persists across worktrees.
 */

/** The local part of the local-dev admin's address; other seeds find the account by it. */
export const LOCAL_DEV_ADMIN_LOCAL_PART = "admin";

/** The fixed admin id older seeds wrote. Read only, to find that account; never written. */
export const RETIRED_ADMIN_USER_ID = "local-dev-admin-user";

/** The domain every seeded account uses unless SEED_EMAIL_DOMAIN overrides it. */
export const DEFAULT_SEED_EMAIL_DOMAIN = "mail.langwatch.localhost";

/** Reads SEED_EMAIL_DOMAIN out of an already-resolved environment; empty is absent. */
export function resolveSeedEmailDomain({
  environment,
}: {
  environment: Readonly<Record<string, unknown>>;
}): string | undefined {
  const value = environment.SEED_EMAIL_DOMAIN;
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** `<localPart>@<domain>` — an override changes only the domain, never the local part. */
export function seedEmailAddress({
  localPart,
  domainOverride,
}: {
  localPart: string;
  domainOverride?: string;
}): string {
  return `${localPart}@${domainOverride ?? DEFAULT_SEED_EMAIL_DOMAIN}`;
}
