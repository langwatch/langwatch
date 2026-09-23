import { SYSTEM_ACTORS } from "@langwatch/actor";
import { extractEmailDomain, isSsoProviderMatch } from "@langwatch/auth-contract";
import {
  RoleBindingScopeType,
  TeamUserRole,
  type AuthzGrantsService,
} from "@langwatch/authz-contract";
import type {
  SsoArrivalApi,
  SsoAuthenticationActivityApi,
  SsoMigrationAccountLinkDecision,
  SsoMigrationCallbackApi,
} from "@langwatch/identity-contract";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { APIError } from "better-auth/api";

import type { BetterAuthHooksRepository } from "../../repositories/better-auth-hooks.repository.ts";
import type {
  BetterAuthAnnouncements,
  BetterAuthFederation,
  BetterAuthPendingInvite,
} from "../better-auth.channel.ts";

/**
 * The KSUID resource prefix a role-binding row is minted under.
 */
const ROLE_BINDING_KSUID_RESOURCE = "rolebinding";

/**
 * The collaborators every hook in this file reaches, handed in together.
 */
export type BetterAuthHookCollaborators = Readonly<{
  federation: BetterAuthFederation;
  invites: BetterAuthPendingInvite;
  announcements: BetterAuthAnnouncements;
  /** The grant ledger an auto-joined membership is written through. */
  authzGrants: AuthzGrantsService;
  /** The connection's own arrival door, asked of every federated sign-in. */
  arrivals: SsoArrivalApi;
  /** Where a sign-in through a connection is recorded as having happened. */
  ssoActivity: SsoAuthenticationActivityApi;
  /** Which of a cutover's two connections this callback belongs to. */
  ssoMigration: SsoMigrationCallbackApi;
}>;

const logger = createLogger("langwatch:better-auth:hooks");

/**
 * Called before a new user is created (via OAuth signup or email+password signup).
 */
export const beforeUserCreate = async ({
  user,
}: {
  repo: BetterAuthHooksRepository;
  // Better Auth hands the stored column value back untyped; only its presence is read.
  user: { email: string; deactivatedAt?: unknown } & Record<string, unknown>;
}): Promise<boolean | undefined> => {
  if (user.deactivatedAt) {
    logger.warn({ email: user.email }, "Blocked signup: user is deactivated");
    return false;
  }
  // No-op: org auto-assignment happens in the after-create hook so that we
  // have a real user id to link with.
  return undefined;
};

/**
 * The organization-scoped grant that comes with a default membership. Idempotent by
 * construction: an identical row already present is skipped, so calling this twice grants
 * nothing twice, and calling it after a membership row turned up on its own is the repair.
 */
const grantDefaultOrgMembership = ({
  writer,
  organizationId,
  userId,
}: {
  writer: AuthzGrantsService;
  organizationId: string;
  userId: string;
}) =>
  writer.attachBindings({
    organizationId,
    bindings: [
      {
        bindingId: generate(ROLE_BINDING_KSUID_RESOURCE).toString(),
        principal: { userId },
        role: TeamUserRole.MEMBER,
        customRoleId: null,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
    ],
    // The signup is the product acting on a domain rule, not an
    // administrator granting access.
    actor: { type: "system", id: SYSTEM_ACTORS.ssoAutoJoin },
    onDuplicate: "skip",
  });

/**
 * Success-side announcements once the membership landed: the log line, the
 * Slack signup event (fire-and-forget), and the nurturing calls.
 */
const announceSsoAutoJoin = ({
  announcements,
  user,
  org,
  inviteId,
}: {
  announcements: BetterAuthAnnouncements;
  user: { id: string; email: string; name: string };
  org: { id: string; name: string };
  inviteId: string | null;
}): void => {
  logger.info(
    { userId: user.id, organizationId: org.id, inviteId },
    inviteId
      ? "Applied pending invite on SSO signup"
      : "Auto-added new user to SSO organization (default MEMBER)",
  );

  announcements.announceSignup({
    userName: user.name,
    userEmail: user.email,
    organizationName: org.name,
  });

  announcements.ssoAutoAddNurturing({
    userId: user.id,
    email: user.email,
    name: user.name,
    organizationId: org.id,
    organizationName: org.name,
  });
};

/**
 * Membership + grant for one domain-matched organization. A pending invite wins when one
 * exists (its role and team assignments carry their own grants); otherwise the default
 * MEMBER membership plus the organization- scoped grant beside it.
 */
const joinSsoOrganization = async ({
  repo,
  collaborators,
  user,
  org,
}: {
  repo: BetterAuthHooksRepository;
  collaborators: BetterAuthHookCollaborators;
  user: { id: string; email: string; name: string };
  org: { id: string; name: string };
}): Promise<void> => {
  const { announcements, invites, authzGrants: writer } = collaborators;
  const pendingInvite = await invites.tryFindPendingByOrganizationAndEmail({
    organizationId: org.id,
    email: user.email,
  });

  if (pendingInvite) {
    await invites.applyInvite({ userId: user.id, invite: pendingInvite });
    announceSsoAutoJoin({ announcements, user, org, inviteId: pendingInvite.id });
    return;
  }

  // The membership row is not a grant fact and keeps its imperative
  // write; the organization-scoped grant that comes with it is a ledger
  // command, emitted once the membership exists (ADR-092).
  const outcome = await repo.createOrganizationMembership({
    userId: user.id,
    organizationId: org.id,
  });
  if (outcome === "already-exists") {
    logger.info(
      { userId: user.id, organizationId: org.id },
      "Auto-add SSO membership was already present (P2002) — treating as success",
    );
    // The membership row existing says nothing about the grant beside it:
    // the concurrent callback that created it may have died in between,
    // and the two writes no longer share a transaction. Re-assert, which
    // is a no-op when the other attempt finished.
    await grantDefaultOrgMembership({
      writer,
      organizationId: org.id,
      userId: user.id,
    });
    return;
  }

  await grantDefaultOrgMembership({
    writer,
    organizationId: org.id,
    userId: user.id,
  });
  announceSsoAutoJoin({ announcements, user, org, inviteId: null });
};

/**
 * Called after a new user is created. Fires the `signed_up` analytics event,
 * then auto-onboards the user into an SSO-matched organization, granting
 * access via a re-assertable ledger command (ADR-092 delivery-plan PR 2).
 */
export const afterUserCreate = async ({
  repo,
  user,
  collaborators,
}: {
  repo: BetterAuthHooksRepository;
  user: { id: string; email: string; name: string; emailVerified: boolean };
  collaborators: BetterAuthHookCollaborators;
}): Promise<void> => {
  // Same distinct_id posthog-js identifies with client-side (the user id),
  // so this server event joins the browser person.
  collaborators.announcements.trackServerEvent({ userId: user.id, event: "signed_up" });

  // Only a verified email proves the signup controls the mailbox an ssoDomain
  // or invite match would admit; credential signups are always created
  // emailVerified=false, so without this gate a mailbox guess at a staff-set
  // ssoDomain would win a membership. The join-request flow demands the same
  // proof (provenDomainOrRefuse) and remains the unverified user's path in.
  if (user.emailVerified !== true) return;

  const domain = extractEmailDomain(user.email);
  if (!domain) return;

  // ADR-027 site #4: domain auto-join is federation and rides the platform
  // gate. When it denies (unlicensed deployment), skip the join — but log it, because on an
  // email-mode install the gate-resolution warning is suppressed (sso-gate.ts), so a
  // staff-set ssoDomain silently losing auto-join would otherwise leave zero trace for an
  // operator debugging "why wasn't this user added to the org".
  const ssoAllowed = await collaborators.federation.platformSsoAllowed();
  if (!ssoAllowed) {
    // warn, matching the gate's own denial-resolution level in sso-gate.ts:
    // both lines have the same root cause, so an operator grepping warn for
    // "why is federation not happening" must not find only half of it.
    logger.warn(
      { domain },
      "Skipped ssoDomain auto-join: platform SSO gate denies (no genuine license)",
    );
    return;
  }

  try {
    const org = await repo.tryFindOrganizationBySsoDomain({ domain });
    if (!org) return;

    await joinSsoOrganization({ repo, collaborators, user, org });
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
 */
export const tryBeforeAccountCreate = async ({
  repo,
  account,
  federation,
}: {
  repo: BetterAuthHooksRepository;
  account: {
    userId: string;
    providerId: string;
    accountId: string;
  };
  federation: BetterAuthFederation;
}): Promise<void> => {
  const user = await repo.tryFindUserForHooks({ userId: account.userId });
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

  // ADR-027: when the platform SSO gate denies, all ssoDomain enforcement is
  // off (site #4, mirroring `afterUserCreate`).
  if (!(await federation.platformSsoAllowed())) {
    // warn for the same reason the `afterUserCreate` site does: an operator
    // grepping warn for "why is federation not happening" has to find both
    // halves of the answer, not one.
    logger.warn(
      { userId: user.id, providerId: account.providerId },
      "Skipped ssoDomain enforcement: platform SSO gate denies (no genuine license)",
    );
    return;
  }

  const domain = extractEmailDomain(user.email);
  if (!domain) return;

  const org = await repo.tryFindOrganizationBySsoDomain({ domain });
  if (!org) return;

  const matchesSso = isSsoProviderMatch(org, {
    providerId: account.providerId,
    accountId: account.accountId,
  });

  if (matchesSso) {
    // Correct SSO provider — let BetterAuth create the Account row. Stale-row
    // reconciliation is deferred to `afterAccountCreate` so it only runs after
    // the new Account row has committed, avoiding a window where the user has
    // `pendingSsoSetup=false` and zero OAuth rows if account creation fails.
    return;
  }

  // Wrong provider for this SSO org. Determine whether this is a first-time
  // signup (hard block) or an existing user trying a different provider
  // (soft block via pendingSsoSetup banner).
  if (account.providerId !== "credential" && org.ssoProvider) {
    const existingAccountCount = await repo.countAccountsForUser({ userId: user.id });
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
  await repo.flagPendingSsoSetup({ userId: user.id });
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
 * The connection's own arrival door. The provider a sign-in arrived through
 * names the connection: a grandfathered one is keyed by the provider this
 * deployment mounted, a self-serve one by the connection the engine dialed.
 */
const admitArrival = async ({
  collaborators,
  repo,
  user,
  email,
  account,
  domain,
}: {
  collaborators: BetterAuthHookCollaborators;
  repo: BetterAuthHooksRepository;
  user: { id: string; name: string | null };
  email: string;
  account: { providerId: string; accountId: string };
  domain: string;
}): Promise<SsoMigrationAccountLinkDecision> => {
  const migration = await decideMigrationLink({ collaborators, repo, account, userId: user.id });
  if (migration.kind === "reject") return migration;

  const connectionId =
    migration.kind === "not_migrating" ? account.providerId : migration.arrivalConnectionId;
  await collaborators.ssoActivity.record({
    connectionId,
    userId: user.id,
    providerAccountId: account.accountId,
  });
  await collaborators.arrivals.admit({
    user: { id: user.id, email, name: user.name ?? "" },
    connectionId,
    domain,
  });
  return migration;
};

/**
 * What the cutover makes of this callback. Decided from the connection log,
 * so the account rows it is weighed against travel from here: auth owns them
 * and identity decides on them.
 */
const decideMigrationLink = async ({
  collaborators,
  repo,
  account,
  userId,
}: {
  collaborators: BetterAuthHookCollaborators;
  repo: BetterAuthHooksRepository;
  account: { providerId: string; accountId: string };
  userId: string;
}): Promise<SsoMigrationAccountLinkDecision> =>
  collaborators.ssoMigration.decideAccountLink({
    userId,
    account: { providerId: account.providerId, accountId: account.accountId },
    otherAccounts: await repo.findFederatedAccountsForUser({ userId }),
  });

/**
 * Called after a new Account row is created. Runs the SSO reconciliation that
 * `tryBeforeAccountCreate` used to perform inline, but deferred to this hook so the cleanup
 * only commits once the new Account row exists.
 */
export const afterAccountCreate = async ({
  repo,
  account,
  collaborators,
}: {
  repo: BetterAuthHooksRepository;
  account: { userId: string; providerId: string; accountId: string };
  collaborators: BetterAuthHookCollaborators;
}): Promise<void> => {
  try {
    if (account.providerId === "credential") return;

    const user = await repo.tryFindUserForHooks({ userId: account.userId });
    const email = user?.email;
    if (!user || !email) return;

    const domain = extractEmailDomain(email);
    if (!domain) return;

    const migration = await admitArrival({ collaborators, repo, user, email, account, domain });
    // A pair's own callback is settled by the decision above: the legacy
    // `ssoDomain` branch below would reconcile away the other side's account.
    if (migration.kind !== "not_migrating") return;

    const org = await repo.tryFindOrganizationBySsoDomain({ domain });
    if (!org) return;

    const matchesSso = isSsoProviderMatch(org, {
      providerId: account.providerId,
      accountId: account.accountId,
    });
    if (!matchesSso) return;

    await repo.reconcileSsoAccounts({
      userId: user.id,
      providerId: account.providerId,
      accountId: account.accountId,
    });
  } catch (err) {
    logger.error(
      { err, userId: account.userId },
      "Failed to reconcile SSO accounts after account create",
    );
  }
};

/**
 * Called after an existing Account row is updated. On an OAuth sign-in via
 * `handleOAuthUserInfo`, BetterAuth refreshes tokens on the linked Account row
 * (`internalAdapter.updateAccount`), which fires this hook.
 */
export const afterAccountUpdate = async ({
  repo,
  account,
  collaborators,
}: {
  repo: BetterAuthHooksRepository;
  account: { userId: string; providerId: string; accountId: string };
  collaborators: BetterAuthHookCollaborators;
}): Promise<void> => {
  try {
    const user = await repo.tryFindUserForHooks({ userId: account.userId });
    const email = user?.email;
    if (!user || !email) return;

    const domain = extractEmailDomain(email);
    if (!domain) return;

    // ASKED ON EVERY SIGN-IN. A returning member creates no account row, so
    // this is the only hook a connection that went live after they first
    // signed in ever gets to admit them through.
    const migration = await admitArrival({ collaborators, repo, user, email, account, domain });
    if (migration.kind !== "not_migrating") return;
    if (!user.pendingSsoSetup) return;

    const org = await repo.tryFindOrganizationBySsoDomain({ domain });
    if (!org) return;

    const matchesSso = isSsoProviderMatch(org, {
      providerId: account.providerId,
      accountId: account.accountId,
    });
    if (!matchesSso) return;

    await repo.reconcileSsoAccounts({
      userId: user.id,
      providerId: account.providerId,
      accountId: account.accountId,
    });

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
 * Blocks deactivated users at this last layer, and refuses a way in the
 * cutover retired: a member linked before it started creates no account row,
 * so this is the only hook their sign-in passes through.
 */
export const beforeSessionCreate = async ({
  repo,
  session,
  path,
  collaborators,
}: {
  repo: BetterAuthHooksRepository;
  session: { userId: string };
  /** better-auth's own endpoint path, which names the callback. */
  path: string | undefined;
  collaborators: BetterAuthHookCollaborators;
}): Promise<boolean | undefined> => {
  const user = await repo.tryFindUserForHooks({ userId: session.userId });
  if (user?.deactivatedAt) {
    logger.warn({ userId: session.userId }, "Blocked session create: user deactivated");
    return false;
  }
  if (user?.signupConfirmationPending) {
    logger.warn({ userId: session.userId }, "Blocked session create: sign-up confirmation pending");
    return false;
  }

  const authentication = await collaborators.ssoMigration.authorizeAndRecordAuthentication({
    userId: session.userId,
    callbackPath: path,
    accounts: await repo.findFederatedAccountsForUser({ userId: session.userId }),
  });
  if (authentication.action === "reject") {
    logger.warn(
      { userId: session.userId, code: authentication.code },
      "Blocked session create: the connection this callback arrived through no longer authenticates",
    );
    // Thrown rather than returned false, so Better Auth carries the code to
    // the sign-in screen as `?error=` instead of a bare failure.
    throw APIError.from("FORBIDDEN", {
      code: authentication.code,
      message: authentication.code,
    });
  }
  return undefined;
};

/**
 * Called after a Session is created. Updates User.lastLoginAt and fires fire-and-forget
 * nurturing hooks. The lastLoginAt update is awaited so the invariant holds immediately
 * for subsequent requests on the same session. Ported from the NextAuth session callback.
 */
export const afterSessionCreate = async ({
  repo,
  userId,
  isImpersonationSession = false,
  announcements,
}: {
  repo: BetterAuthHooksRepository;
  userId: string;
  isImpersonationSession?: boolean;
  announcements: BetterAuthAnnouncements;
}): Promise<void> => {
  // lastLoginAt is only updated for "real" sessions — not admin impersonation.
  if (!isImpersonationSession) {
    try {
      await repo.recordLastLogin({ userId });
    } catch (err) {
      logger.error({ err, userId }, "Failed to update lastLoginAt after session create");
    }
  }

  // Nurturing hooks: fire-and-forget, must never block the response.
  void repo
    .countOrgMembershipsForUser({ userId })
    .then((count) => {
      announcements.sessionNurturing({ userId, hasOrganization: count > 0 });
    })
    .catch((err) => {
      logger.error({ err, userId }, "Failed to fire nurturing hooks after session create");
    });
};
