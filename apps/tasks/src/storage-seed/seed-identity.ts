/**
 * Pure address-resolution helpers for the local-dev seed (seed.ts), split
 * out for testability without booting Prisma. Unset SEED_EMAIL_DOMAIN
 * keeps one stable address, so a saved password-manager login persists across worktrees.
 */

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

/**
 * The admin User upsert's where/create/update payload. Keyed on the fixed
 * `adminUserId`, never on email, so a reseed always finds and rewrites THIS
 * account in place — a domain change can never produce a second admin account.
 */
export function buildAdminUserUpsertArgs({
  adminUserId,
  email,
  name,
}: {
  adminUserId: string;
  email: string;
  name: string;
}) {
  return {
    where: { id: adminUserId },
    create: { id: adminUserId, email, name, emailVerified: true },
    update: { email },
  };
}
