import { extractEmailDomain, isSsoProviderMatch } from "@langwatch/auth-contract";
import { SYSTEM_ACTORS } from "@langwatch/authorization";
import {
  GrantScopeTier,
  newAuthzGrantId,
  TeamUserRole,
  type AuthzGrantsService,
} from "@langwatch/authz-contract";
import { isNativeSocialProvider } from "@langwatch/enterprise-sso-contract/sign-in-providers";
import { HandledError } from "@langwatch/handled-error";
import {
  type IdentityApi,
  NO_SESSION_CLAIMS,
  type SessionClaims,
  signInProviderForPath,
  type SsoArrivalApi,
  type SsoAuthenticationActivityApi,
  type SsoMigrationAccountLinkDecision,
  type SsoMigrationCallbackApi,
} from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { fromDate } from "@langwatch/time";
import type { BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";

import type { BetterAuthHooksRepository } from "../../repositories/better-auth-hooks.repository.ts";
import type { BetterAuthAnnouncements, BetterAuthFederation } from "../better-auth.channel.ts";
import type {
  AcceptedCallbackAccount,
  SessionCallbackEvidenceChannel,
} from "./http.session-callback-evidence.channel.ts";

/**
 * The collaborators every hook in this file reaches, handed in together.
 */
export type BetterAuthHookCollaborators = Readonly<{
  federation: BetterAuthFederation;
  /** A pending invite at a domain-matched organization wins over the default membership. */
  invites: Pick<OrganizationApi, "applyPendingInvite">;
  /** The organization an SSO domain names, and the membership an auto-join writes there. */
  organizations: SsoDomainOrganizations;
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

/** Organization reads and writes the hooks make through organization's own Api. */
export type SsoDomainOrganizations = Pick<
  OrganizationApi,
  "findBySsoDomain" | "createSsoDomainMembership" | "countMembershipsForUser"
>;

/** Whether the installation admits a new account for an address. */
export type SignUpPolicy = Pick<OrganizationApi, "checkSignUp">;

const logger = createLogger("langwatch:better-auth:hooks");

/**
 * Called before a new user is created (via OAuth signup or email+password signup).
 */
export function createBeforeUserCreateHook({
  policy,
  findGoverningConnections,
}: {
  policy: SignUpPolicy;
  findGoverningConnections: FindGoverningConnections;
}): NonNullable<
  NonNullable<
    NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["user"]>["create"]
  >["before"]
> {
  return async (user) => {
    if (user.deactivatedAt) {
      logger.warn("Blocked signup: user is deactivated");
      return false;
    }
    await refuseRestrictedSignUp({ email: user.email, policy, findGoverningConnections });
    // Org auto-assignment happens in the after-create hook so that we have a
    // real user id to link with.
    return undefined;
  };
}

/**
 * The one place every way of creating an account passes through, federated
 * sign-in included. An address an organization's own connection governs is
 * admitted: the organization that configured the connection vouches for it.
 */
async function refuseRestrictedSignUp({
  email,
  policy,
  findGoverningConnections,
}: {
  email: string;
  policy: SignUpPolicy;
  findGoverningConnections: FindGoverningConnections;
}): Promise<void> {
  const verdict = await policy.checkSignUp({ email });
  if (verdict.allowed) return;
  if ((await findGoverningConnections({ email })).length > 0) return;

  logger.warn({ reason: verdict.reason }, "Refused sign-up: the installation restricts it");
  // Thrown rather than returned false, so Better Auth carries the code to the
  // sign-in screen as `?error=`.
  throw APIError.from("FORBIDDEN", {
    code: SIGN_UP_RESTRICTED_CODE,
    message: SIGN_UP_RESTRICTED_CODE,
  });
}

/** The code the sign-in screen and the passkey ceremony read a restricted sign-up by. */
export const SIGN_UP_RESTRICTED_CODE = "auth_sign_up_restricted";

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
        bindingId: newAuthzGrantId(),
        principal: { userId },
        role: TeamUserRole.MEMBER,
        customRoleId: null,
        scopeType: GrantScopeTier.ORGANIZATION,
        scopeId: organizationId,
      },
    ],
    // The signup is the product acting on a domain rule, not an
    // administrator granting access.
    caller: { type: "system" },
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
  collaborators,
  user,
  org,
}: {
  collaborators: BetterAuthHookCollaborators;
  user: { id: string; email: string; name: string };
  org: { id: string; name: string };
}): Promise<void> => {
  const { announcements, invites, authzGrants: writer } = collaborators;
  const invite = await invites.applyPendingInvite({
    userId: user.id,
    organizationId: org.id,
    email: user.email,
  });

  if (invite.applied) {
    announceSsoAutoJoin({ announcements, user, org, inviteId: invite.inviteId });
    return;
  }

  // The membership row is not a grant fact and keeps its imperative
  // write; the organization-scoped grant that comes with it is a ledger
  // command, emitted once the membership exists (ADR-092).
  const outcome = await collaborators.organizations.createSsoDomainMembership({
    userId: user.id,
    organizationId: org.id,
  });
  if (outcome === "already-present") {
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
 * Called after a new user is created. Records the sign-up for nurturing,
 * then auto-onboards the user into an SSO-matched organization, granting
 * access via a re-assertable ledger command (ADR-092 delivery-plan PR 2).
 */
export const afterUserCreate = async ({
  user,
  collaborators,
}: {
  user: { id: string; email: string; name: string; emailVerified: boolean };
  collaborators: BetterAuthHookCollaborators;
}): Promise<void> => {
  // Nurturing tracks PostHog signed_up under the user id, the distinct_id posthog-js uses.
  collaborators.announcements.signUpNurturing({ userId: user.id });

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
    const org = await collaborators.organizations.findBySsoDomain({ domain });
    if (!org) return;

    await joinSsoOrganization({ collaborators, user, org });
  } catch (err) {
    logger.error(
      { err, userId: user.id, domain },
      "Failed to auto-add new user to SSO organization (signup still succeeds)",
    );
  }
};

/**
 * The organization connections that govern an address (D04), asked of the sign-in router, each
 * with the METHOD it is dialled by: a grandfathered connection is reached through the broker.
 */
export type FindGoverningConnections = (input: {
  email: string;
}) => Promise<readonly { connectionId: string; methodId: string }[]>;

/**
 * A native social button pressed by somebody whose organization's connection governs their
 * address is sent to that connection: better-auth carries the message into `error_description`,
 * and the error route dials it (specs/identity/native-social-at-a-claimed-domain.feature).
 */
async function bounceNativeProviderToConnection({
  email,
  account,
  findGoverningConnections,
}: {
  email: string;
  account: { userId: string; providerId: string };
  findGoverningConnections: FindGoverningConnections;
}): Promise<void> {
  if (!isNativeSocialProvider(account.providerId)) return;
  const [governing] = await findGoverningConnections({ email });
  if (governing === undefined) return;
  const { connectionId, methodId } = governing;
  // Only a connection that dials itself: the error route dials the id this refusal carries, and
  // a brokered connection has no door under it. The legacy guard below refuses those instead.
  if (methodId !== connectionId) {
    logger.info(
      { userId: account.userId, attemptedProvider: account.providerId, connectionId, methodId },
      "Left a native social sign-in to the legacy guard: the connection is reached through the broker",
    );
    return;
  }

  logger.info(
    { userId: account.userId, attemptedProvider: account.providerId, connectionId },
    "Sent a native social sign-in to the organization's own connection",
  );
  throw APIError.from("FORBIDDEN", {
    code: "SSO_REQUIRED_BY_ORGANIZATION",
    message: connectionId,
  });
}

/**
 * A native social provider the SSO-enforced organization does not use is refused whoever presses
 * it; any other provider only on a first sign-up, since a broker mid-migration is soft-flagged.
 */
async function refuseWrongProvider({
  repo,
  userId,
  attemptedProvider,
  orgSsoProvider,
}: {
  repo: BetterAuthHooksRepository;
  userId: string;
  attemptedProvider: string;
  orgSsoProvider: string;
}): Promise<void> {
  if (
    !isNativeSocialProvider(attemptedProvider) &&
    (await repo.countAccountsForUser({ userId })) !== 0
  ) {
    return;
  }
  logger.warn(
    { userId, attemptedProvider, orgSsoProvider },
    "Refused sign-in: provider does not match SSO-enforced org",
  );
  // Throw APIError so BetterAuth surfaces the specific code in the
  // callback redirect (?error=SSO_PROVIDER_NOT_ALLOWED), which the
  // /auth/error page knows how to render with a friendly message.
  throw APIError.from("FORBIDDEN", {
    code: "SSO_PROVIDER_NOT_ALLOWED",
    message: "SSO_PROVIDER_NOT_ALLOWED",
  });
}

/**
 * Called before a new Account row is created. Ports the provider-linking and
 * pendingSsoSetup logic from the NextAuth signIn callback.
 */
export function createBeforeAccountCreateHook({
  repo,
  organizations,
  federation,
  findGoverningConnections,
}: {
  repo: BetterAuthHooksRepository;
  organizations: Pick<SsoDomainOrganizations, "findBySsoDomain">;
  federation: BetterAuthFederation;
  findGoverningConnections: FindGoverningConnections;
}): NonNullable<
  NonNullable<
    NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["account"]>["create"]
  >["before"]
> {
  return async (account) => {
    const user = await repo
      .getUserForHooks({ userId: account.userId })
      .catch(skipOn("user_not_found"));
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

    // The organization's own connection first; the legacy columns below answer the rest.
    await bounceNativeProviderToConnection({
      email: user.email,
      account,
      findGoverningConnections,
    });

    const domain = extractEmailDomain(user.email);
    if (!domain) return;

    const org = await organizations.findBySsoDomain({ domain });
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

    // Wrong provider for this SSO org: a native one or a first sign-up is refused,
    // an existing member on the broker is soft-blocked via the pendingSsoSetup banner.
    if (account.providerId !== "credential" && org.ssoProvider) {
      await refuseWrongProvider({
        repo,
        userId: user.id,
        attemptedProvider: account.providerId,
        orgSsoProvider: org.ssoProvider,
      });
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
}

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
 * the before-account-create hook used to perform inline, but deferred to this hook so the cleanup
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

    const user = await repo
      .getUserForHooks({ userId: account.userId })
      .catch(skipOn("user_not_found"));
    const email = user?.email;
    if (!user || !email) return;

    const domain = extractEmailDomain(email);
    if (!domain) return;

    const migration = await admitArrival({ collaborators, repo, user, email, account, domain });
    // A pair's own callback is settled by the decision above: the legacy
    // `ssoDomain` branch below would reconcile away the other side's account.
    if (migration.kind !== "not_migrating") return;

    const org = await collaborators.organizations.findBySsoDomain({ domain });
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
  findGoverningConnections,
}: {
  repo: BetterAuthHooksRepository;
  account: { userId: string; providerId: string; accountId: string };
  collaborators: BetterAuthHookCollaborators;
  findGoverningConnections: FindGoverningConnections;
}): Promise<void> => {
  // Outside the try below: a refusal its catch swallowed would admit the sign-in it stops.
  await refuseNativeProviderOnSignIn({
    repo,
    organizations: collaborators.organizations,
    account,
    federation: collaborators.federation,
    findGoverningConnections,
  });

  try {
    const user = await repo
      .getUserForHooks({ userId: account.userId })
      .catch(skipOn("user_not_found"));
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

    const org = await collaborators.organizations.findBySsoDomain({ domain });
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
 * better-auth creates an account row ONCE and only updates it on every sign-in after, so a
 * create-path guard alone would let every already-linked native holder keep signing in. Both
 * refusals, in the create path's order: the organization's connection, then the legacy columns.
 */
async function refuseNativeProviderOnSignIn({
  repo,
  organizations,
  account,
  federation,
  findGoverningConnections,
}: {
  repo: BetterAuthHooksRepository;
  organizations: Pick<SsoDomainOrganizations, "findBySsoDomain">;
  account: { userId: string; providerId: string; accountId: string };
  federation: BetterAuthFederation;
  findGoverningConnections: FindGoverningConnections;
}): Promise<void> {
  if (!isNativeSocialProvider(account.providerId)) return;
  if (!(await federation.platformSsoAllowed())) return;

  const user = await repo
    .getUserForHooks({ userId: account.userId })
    .catch(skipOn("user_not_found"));
  if (!user?.email) return;
  const domain = extractEmailDomain(user.email);
  if (!domain) return;

  await bounceNativeProviderToConnection({ email: user.email, account, findGoverningConnections });

  const org = await organizations.findBySsoDomain({ domain });
  // A provider the organization pinned is its own front door, whatever kind it is.
  if (!org?.ssoProvider || isSsoProviderMatch(org, account)) return;

  logger.warn(
    { userId: account.userId, attemptedProvider: account.providerId, path: "account_update" },
    "Refused sign-in: provider does not match SSO-enforced org",
  );
  throw APIError.from("FORBIDDEN", {
    code: "SSO_PROVIDER_NOT_ALLOWED",
    message: "SSO_PROVIDER_NOT_ALLOWED",
  });
}

/**
 * Blocks deactivated users at this last layer, and refuses a way in the
 * cutover retired: a member linked before it started creates no account row,
 * so this is the only hook their sign-in passes through.
 */
export function createBeforeSessionCreateHook({
  repo,
  collaborators,
  sessionClaims,
}: {
  repo: BetterAuthHooksRepository;
  collaborators: BetterAuthHookCollaborators;
  sessionClaims: SessionMintClaims;
}): NonNullable<
  NonNullable<
    NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["session"]>["create"]
  >["before"]
> {
  return async (session, context) => {
    const path =
      context?.path === undefined ? undefined : toConcretePath(context.path, context.params);
    const user = await repo
      .getUserForHooks({ userId: session.userId })
      .catch(skipOn("user_not_found"));
    if (user?.deactivatedAt) {
      logger.warn({ userId: session.userId }, "Blocked session create: user deactivated");
      return false;
    }
    if (user?.signupConfirmationPending) {
      logger.warn(
        { userId: session.userId },
        "Blocked session create: sign-up confirmation pending",
      );
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
    const claims = await mintClaims({ userId: session.userId, path, context, sessionClaims });
    if (claims.identifierId === null && claims.amr.length === 0) return undefined;
    return {
      data: {
        ...session,
        amr: [...claims.amr],
        ...(claims.identifierId === null ? {} : { identifierId: claims.identifierId }),
      },
    };
  };
}

/** What a session records at mint, asked of identity with this request's callback evidence. */
export type SessionMintClaims = Readonly<{
  identity: Pick<IdentityApi, "claimsForMint">;
  evidence: Pick<SessionCallbackEvidenceChannel, "findAcceptedAccounts">;
}>;

/** Better Auth hands the route pattern (`.../acs/:providerId`); readers need the real path. */
function toConcretePath(path: string, params: Record<string, string | undefined> = {}): string {
  return path.replace(/:([A-Za-z]+)/g, (whole, name: string) => params[name] ?? whole);
}

type SessionMintContext = Parameters<ReturnType<typeof createBeforeSessionCreateHook>>[1];

/**
 * Which way in minted the session and what it proved (D06), from identity's answer. A
 * failure records nothing, an ordinary session, never a refused one.
 * specs/identity/saml-existing-user-linking.feature, specs/identity/mfa-and-session-shape.feature
 */
async function mintClaims({
  userId,
  path,
  context,
  sessionClaims,
}: {
  userId: string;
  path: string | undefined;
  context: SessionMintContext;
  sessionClaims: SessionMintClaims;
}): Promise<SessionClaims> {
  if (!path) return NO_SESSION_CLAIMS;
  const reading = signInProviderForPath({ path });
  if (!reading.recognized) return NO_SESSION_CLAIMS;
  try {
    const [accepted, ...others] = sessionClaims.evidence.findAcceptedAccounts({
      providerId: reading.provider,
    });
    const callback =
      accepted && others.length === 0
        ? {
            providerAccountId: accepted.providerAccountId,
            assertedFactors: accepted.assertedFactors,
            verifiedTokenClaims: accepted.verifiedTokenClaims,
            ...(await callbackAccountFor({ userId, accepted, context })),
          }
        : undefined;
    return await sessionClaims.identity.claimsForMint({
      userId,
      path,
      ...(callback ? { callback } : {}),
    });
  } catch (error) {
    logger.warn({ error, userId }, "Session claims failed; the session records none");
    return NO_SESSION_CLAIMS;
  }
}

/**
 * The one native account row for the accepted subject, read through Better Auth's own
 * adapter so the callback's transaction sees the row it just wrote; several or none is
 * uncertain evidence and derives nothing.
 */
async function callbackAccountFor({
  userId,
  accepted,
  context,
}: {
  userId: string;
  accepted: AcceptedCallbackAccount;
  context: SessionMintContext;
}): Promise<{ account?: { accountId: string; createdAtMs: number; email: string } }> {
  const adapter = context?.context?.internalAdapter;
  if (!adapter) return {};
  const accounts = (await adapter.findAccounts(userId)).filter(
    (row) => row.providerId === accepted.providerId && row.accountId === accepted.providerAccountId,
  );
  const [account, ...others] = accounts;
  if (!account || others.length > 0) return {};
  const user = await adapter.findUserById(userId);
  if (!user?.email) return {};
  return {
    account: {
      accountId: account.id,
      createdAtMs: fromDate(account.createdAt).epochMilliseconds,
      email: user.email,
    },
  };
}

/**
 * Called after a Session is created. Updates User.lastLoginAt and fires fire-and-forget
 * nurturing hooks. The lastLoginAt update is awaited so the invariant holds immediately
 * for subsequent requests on the same session. Ported from the NextAuth session callback.
 */
export const afterSessionCreate = async ({
  repo,
  organizations,
  userId,
  isImpersonationSession = false,
  announcements,
}: {
  repo: BetterAuthHooksRepository;
  organizations: Pick<SsoDomainOrganizations, "countMembershipsForUser">;
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
  void organizations
    .countMembershipsForUser({ userId })
    .then((count) => {
      // Main sent nothing for a person still onboarding, so no ghost person is made.
      if (count > 0) announcements.sessionNurturing({ userId });
    })
    .catch((err) => {
      logger.error({ err, userId }, "Failed to fire nurturing hooks after session create");
    });
};

/** Rethrows every failure but the one read's not-found `code`, which the hook skips past. */
function skipOn(code: string): (error: unknown) => undefined {
  return (error) => {
    if (HandledError.isHandled(error) && error.code === code) return undefined;
    throw error;
  };
}
