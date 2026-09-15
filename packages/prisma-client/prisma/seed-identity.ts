/**
 * Pure address-resolution helpers for the local-dev seed (seed.ts), split out
 * so the rules are testable without booting Prisma.
 *
 * SEED_EMAIL_DOMAIN is a purely opt-in per-stack override. Unset, every
 * seeded account uses DEFAULT_SEED_EMAIL_DOMAIN — one stable, global address
 * that works on every worktree and keeps a saved password-manager login
 * working across worktrees and reseeds. Set, every seeded account's domain
 * moves to it; local parts never change. haven never sets this itself.
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
 * `adminUserId`, never on email, so a reseed always finds THIS account —
 * whatever address it was seeded under before (including the retired
 * admin@haven.localhost default) — and rewrites its email in place. Because
 * the lookup never goes through email, a domain change (or the one-time
 * rename) can never produce a second admin account.
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
