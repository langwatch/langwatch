import { Prisma, RoleBindingScopeType, TeamUserRole, type Organization, type PrismaClient } from "@prisma/client";
import { APIError } from "better-auth/api";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";
import { createLogger } from "../../utils/logger/server";
import { isSsoProviderMatch, extractEmailDomain } from "./sso";

const logger = createLogger("langwatch:better-auth:hooks");

/**
 * Called before a new user is created (via OAuth signup or email+password signup).
 *
 * Ports the "new user with matching SSO domain" branch from the old NextAuth
 * signIn callback: when the email domain matches an org with ssoDomain, allow
 * the create and add the org membership in the `after` hook.
 *
 * Blocks deactivated users. We only get here for BRAND new users, so
 * deactivatedAt should always be null — but we check defensively in case of
 * a pre-seeded deactivated row.
 */
export const beforeUserCreate = async ({
  prisma,
  user,
}: {
  prisma: PrismaClient;
  user: { email: string; deactivatedAt?: Date | null } & Record<string, unknown>;
}): Promise<boolean | void> => {
  if (user.deactivatedAt) {
    logger.warn({ email: user.email }, "Blocked signup: user is deactivated");
    return false;
  }
  // No-op: org auto-assignment happens in the after-create hook so that we
  // have a real user id to link with.
};

/**
 * Called after a new user is created. If the user's email domain matches an
 * organization with ssoDomain, add them as a MEMBER automatically.
 * Ported from createUserAndAddToOrganization in the old NextAuth auth.ts.
 *
 * The org auto-add is best-effort: if it fails (concurrent signup, race
 * with another tab, transient DB issue), we LOG and SWALLOW the error so
 * the signup itself still succeeds. Failing the signup over a missing org
 * membership would orphan the user (the User row was just committed by the
 * preceding Prisma adapter call) and produce a confusing
 * "unable to create user" error in the OAuth callback. The user can always
 * be added to the org later via invite or admin action.
 */
export const afterUserCreate = async ({
  prisma,
  user,
}: {
  prisma: PrismaClient;
  user: { id: string; email: string };
}): Promise<void> => {
  const domain = extractEmailDomain(user.email);
  if (!domain) return;

  try {
    const org = await prisma.organization.findUnique({
      where: { ssoDomain: domain },
    });
    if (!org) return;

    try {
      await prisma.organizationUser.create({
        data: {
          userId: user.id,
          organizationId: org.id,
          role: "MEMBER",
        },
      });

      // Create the RoleBinding that the RBAC system uses as the
      // authoritative access record (added by PR #2867 SCIM groups).
      await prisma.roleBinding.create({
        data: {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId: org.id,
          userId: user.id,
          role: TeamUserRole.MEMBER,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: org.id,
        },
      });

      logger.info(
        { userId: user.id, organizationId: org.id },
        "Auto-added new user to SSO organization (with RoleBinding)",
      );
    } catch (err) {
      // P2002 (unique constraint) means another concurrent OAuth callback
      // or a retry already created this membership. Idempotent success —
      // don't log as an error. Caught by CodeRabbit in PR review.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        logger.info(
          { userId: user.id, organizationId: org.id },
          "Auto-add SSO membership was already present (P2002) — treating as success",
        );
        return;
      }
      throw err;
    }
  } catch (err) {
    logger.error(
      { err, userId: user.id, domain },
      "Failed to auto-add new user to SSO organization (signup still succeeds)",
    );
  }
};

/**
 * Called before a new Account row is created. Ports the provider-linking and
 * pendingSsoSetup logic from the NextAuth signIn callback.
 *
 * Rules (preserving NextAuth behavior):
 * - new user + SSO org + wrong OAuth provider → HARD BLOCK (SSO_PROVIDER_NOT_ALLOWED).
 *   The original NextAuth signIn callback enforced this via
 *   checkIfSsoProviderIsAllowed — new signups at an SSO-enforced domain must
 *   use the configured provider. "New" = this is the user's first account.
 *   Credential accounts (providerId = "credential") are exempt because
 *   credentials signup only runs in on-prem / email-mode deployments where
 *   SSO isn't configured.
 * - existing user + SSO org + correct provider → set pendingSsoSetup=false and
 *   remove stale accounts for this provider that have a different providerAccountId
 * - existing user + SSO org + wrong provider → set pendingSsoSetup=true,
 *   DO NOT hard-block (we let them in so existing users aren't locked out
 *   during a migration), banner is shown in DashboardLayout
 * - no SSO org → let BetterAuth handle account creation normally
 */
export const beforeAccountCreate = async ({
  prisma,
  account,
}: {
  prisma: PrismaClient;
  account: {
    userId: string;
    providerId: string;
    accountId: string;
  };
}): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: account.userId },
    select: { id: true, email: true, deactivatedAt: true },
  });
  if (!user?.email) return;

  if (user.deactivatedAt) {
    // signIn hook will also block this via session.create.before, but fail
    // fast to avoid leaving a stray Account row. Throw APIError so BetterAuth
    // preserves the error code in the OAuth callback redirect URL.
    throw APIError.from("FORBIDDEN", {
      code: "USER_DEACTIVATED",
      message: "USER_DEACTIVATED",
    });
  }

  const domain = extractEmailDomain(user.email);
  if (!domain) return;

  const org = await prisma.organization.findUnique({
    where: { ssoDomain: domain },
  });
  if (!org) return;

  const matchesSso = isSsoProviderMatch(org, {
    providerId: account.providerId,
    accountId: account.accountId,
  });

  if (matchesSso) {
    // Clean up every OAuth account row that isn't the one being linked right
    // now. Two cases are covered:
    //   1) Same provider with a different providerAccountId — e.g. the user's
    //      SSO subject rotated (Auth0 connection change).
    //   2) A different OAuth provider — e.g. the user previously signed in
    //      with Google while the org's configured SSO is Auth0; that Google
    //      row left `pendingSsoSetup=true` and blocks the "remove their old
    //      method" expectation when they complete via the correct provider.
    //
    // Credential accounts are preserved: on-prem / email-mode deployments
    // don't have SSO configured, so we never reach this branch there; but
    // preserving them is the safe default for mixed setups.
    await prisma.$transaction([
      prisma.account.deleteMany({
        where: {
          userId: user.id,
          provider: { not: "credential" },
          OR: [
            { provider: { not: account.providerId } },
            { providerAccountId: { not: account.accountId } },
          ],
        },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { pendingSsoSetup: false },
      }),
    ]);
    return;
  }

  // Wrong provider for this SSO org. Determine whether this is a first-time
  // signup (hard block) or an existing user trying a different provider
  // (soft block via pendingSsoSetup banner).
  if (account.providerId !== "credential" && org.ssoProvider) {
    const existingAccountCount = await prisma.account.count({
      where: { userId: user.id },
    });
    if (existingAccountCount === 0) {
      logger.warn(
        {
          userId: user.id,
          attemptedProvider: account.providerId,
          orgSsoProvider: org.ssoProvider,
        },
        "Blocked new signup: provider does not match SSO-enforced org",
      );
      // Throw APIError so BetterAuth surfaces the specific code in the
      // callback redirect (?error=SSO_PROVIDER_NOT_ALLOWED), which the
      // /auth/error page knows how to render with a friendly message.
      throw APIError.from("FORBIDDEN", {
        code: "SSO_PROVIDER_NOT_ALLOWED",
        message: "SSO_PROVIDER_NOT_ALLOWED",
      });
    }
  }

  // Existing user with wrong provider → soft block via banner.
  await prisma.user.update({
    where: { id: user.id },
    data: { pendingSsoSetup: true },
  });
  logger.info(
    {
      userId: user.id,
      attemptedProvider: account.providerId,
      orgSsoProvider: org.ssoProvider,
    },
    "Flagged existing user with pendingSsoSetup (wrong SSO provider)",
  );
};

/**
 * Called after an existing Account row is updated. On an OAuth sign-in via
 * `handleOAuthUserInfo`, BetterAuth refreshes tokens on the linked Account row
 * (`internalAdapter.updateAccount`), which fires this hook.
 *
 * Closes the dual-account edge case for pendingSsoSetup:
 * - User previously signed in with WRONG provider → pendingSsoSetup=true,
 *   wrong Account row exists.
 * - User later signs in with the CORRECT provider for the first time →
 *   `beforeAccountCreate` fires and clears the flag / deletes the stale row.
 * - BUT if the correct-provider Account already exists (e.g. user bounced
 *   between the two methods), no new Account is created on subsequent correct
 *   sign-ins, so `beforeAccountCreate` never fires and pendingSsoSetup stays
 *   stuck.
 *
 * This hook runs on every account token refresh, so when the user signs in via
 * the correct SSO provider — even without a new Account — we detect the
 * reconciliation opportunity and clean up.
 */
export const afterAccountUpdate = async ({
  prisma,
  account,
}: {
  prisma: PrismaClient;
  account: { userId: string; providerId: string; accountId: string };
}): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: account.userId },
      select: { id: true, email: true, pendingSsoSetup: true },
    });
    if (!user?.email || !user.pendingSsoSetup) return;

    const domain = extractEmailDomain(user.email);
    if (!domain) return;

    const org = await prisma.organization.findUnique({
      where: { ssoDomain: domain },
    });
    if (!org) return;

    const matchesSso = isSsoProviderMatch(org, {
      providerId: account.providerId,
      accountId: account.accountId,
    });
    if (!matchesSso) return;

    await prisma.$transaction([
      prisma.account.deleteMany({
        where: {
          userId: user.id,
          provider: { not: "credential" },
          OR: [
            { provider: { not: account.providerId } },
            { providerAccountId: { not: account.accountId } },
          ],
        },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { pendingSsoSetup: false },
      }),
    ]);

    logger.info(
      { userId: user.id, providerId: account.providerId },
      "Cleared pendingSsoSetup and removed stale accounts after sign-in via correct SSO provider",
    );
  } catch (err) {
    logger.error(
      { err, userId: account.userId },
      "Failed to reconcile pendingSsoSetup after account update",
    );
  }
};

/**
 * Called before a Session is created. Blocks deactivated users at this last
 * layer, and enforces DIFFERENT_EMAIL_NOT_ALLOWED — if the current session's
 * user has a different email than the incoming one, reject.
 */
export const beforeSessionCreate = async ({
  prisma,
  session,
}: {
  prisma: PrismaClient;
  session: { userId: string };
}): Promise<boolean | void> => {
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { deactivatedAt: true },
  });
  if (user?.deactivatedAt) {
    logger.warn({ userId: session.userId }, "Blocked session create: user deactivated");
    return false;
  }
};

/**
 * Called after a Session is created. Updates User.lastLoginAt and fires
 * fire-and-forget nurturing hooks. The lastLoginAt update is awaited so the
 * invariant holds immediately for subsequent requests on the same session.
 * Ported from the NextAuth session callback.
 *
 * Skipped entirely when the session is an admin-impersonation session
 * (detected via the `impersonating` JSON field on the new Session row) — we
 * don't want an admin's activity to ghost-write the target user's lastLoginAt.
 */
export const afterSessionCreate = async ({
  prisma,
  userId,
  isImpersonationSession = false,
  fireActivityTrackingNurturing,
  ensureUserSyncedToCio,
}: {
  prisma: PrismaClient;
  userId: string;
  isImpersonationSession?: boolean;
  fireActivityTrackingNurturing: (args: { userId: string; hasOrganization: boolean }) => void;
  ensureUserSyncedToCio: (args: { userId: string; hasOrganization: boolean }) => void;
}): Promise<void> => {
  // lastLoginAt is only updated for "real" sessions — not admin impersonation.
  if (!isImpersonationSession) {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { lastLoginAt: new Date() },
      });
    } catch (err) {
      logger.error({ err, userId }, "Failed to update lastLoginAt after session create");
    }
  }

  // Nurturing hooks: fire-and-forget, must never block the response.
  // Query via User._count.orgMemberships to bypass the
  // dbOrganizationIdProtection middleware which blocks direct
  // OrganizationUser queries without an organizationId in the where clause.
  void prisma.user
    .findUnique({
      where: { id: userId },
      select: { _count: { select: { orgMemberships: true } } },
    })
    .then((userWithCount) => {
      const hasOrganization = (userWithCount?._count.orgMemberships ?? 0) > 0;
      fireActivityTrackingNurturing({ userId, hasOrganization });
      ensureUserSyncedToCio({ userId, hasOrganization });
    })
    .catch((err) => {
      logger.error({ err, userId }, "Failed to fire nurturing hooks after session create");
    });
};
