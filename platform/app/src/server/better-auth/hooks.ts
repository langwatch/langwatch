import { extractEmailDomain, isSsoProviderMatch } from "@ee/sso/matching";
import { platformSSOAllowed } from "@ee/sso/sso-gate";
import { SYSTEM_ACTORS } from "@langwatch/actor";
import { normalizeDomain, type SsoArrivalPolicy } from "@langwatch/identity";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { APIError } from "better-auth/api";
import {
  Prisma,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { getApp } from "~/server/app-layer/app";
import {
  type GrantsLedgerWriter,
  grantsLedgerWriter,
} from "~/server/app-layer/authz/ledger";
import {
  joinRequestsService,
  looksLikeSsoConnectionId,
} from "~/server/app-layer/identity/runtime";
import { InviteService } from "~/server/invites/invite.service";
import { trackServerEvent } from "~/server/posthog";
import { KSUID_RESOURCES } from "~/utils/constants";
import { fireSsoAutoAddNurturingCalls } from "../../../ee/billing/nurturing/hooks/ssoAutoAdd";
import { captureException } from "../../utils/posthogErrorCapture";

const logger = createLogger("langwatch:better-auth:hooks");

/**
 * Atomically deletes every OAuth account row for the user EXCEPT the one being
 * linked/refreshed, and clears `pendingSsoSetup`. Used by both
 * `beforeAccountCreate` (first time the correct SSO provider is linked) and
 * `afterAccountUpdate` (subsequent sign-ins via the correct provider when the
 * Account row already exists). Credential accounts are preserved for on-prem /
 * email-mode deployments.
 */
const reconcileSsoAccounts = async ({
  prisma,
  userId,
  providerId,
  accountId,
}: {
  prisma: PrismaClient;
  userId: string;
  providerId: string;
  accountId: string;
}): Promise<void> => {
  await prisma.$transaction([
    prisma.account.deleteMany({
      where: {
        userId,
        provider: { not: "credential" },
        OR: [
          { provider: { not: providerId } },
          { providerAccountId: { not: accountId } },
        ],
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { pendingSsoSetup: false },
    }),
  ]);
};

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
  user: { email: string; deactivatedAt?: Date | null } & Record<
    string,
    unknown
  >;
}): Promise<boolean | void> => {
  if (user.deactivatedAt) {
    logger.warn({ email: user.email }, "Blocked signup: user is deactivated");
    return false;
  }
  // No-op: org auto-assignment happens in the after-create hook so that we
  // have a real user id to link with.
};

/**
 * The organization-scoped grant that comes with a default membership.
 * Idempotent by construction: an identical row already present is skipped,
 * so calling this twice grants nothing twice, and calling it after a
 * membership row turned up on its own is the repair.
 */
const grantDefaultOrgMembership = ({
  writer,
  organizationId,
  userId,
}: {
  writer: GrantsLedgerWriter;
  organizationId: string;
  userId: string;
}) =>
  writer.attachBindings({
    organizationId,
    bindings: [
      {
        bindingId: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
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
  user,
  org,
  inviteId,
}: {
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

  void getApp()
    .notifications.sendSlackSignupEvent({
      userName: user.name,
      userEmail: user.email,
      organizationName: org.name,
    })
    .catch(captureException);

  fireSsoAutoAddNurturingCalls({
    userId: user.id,
    email: user.email,
    name: user.name,
    organizationId: org.id,
    organizationName: org.name,
  });
};

/**
 * Membership + grant for one domain-matched organization. A pending invite
 * wins when one exists (its role and team assignments carry their own
 * grants); otherwise the default MEMBER membership plus the organization-
 * scoped grant beside it. P2002 on the membership means a concurrent OAuth
 * callback or a retry created the row first — treated as success, with the
 * grant re-asserted rather than assumed, because the concurrent callback
 * may have died between the two writes.
 */
const joinSsoOrganization = async ({
  prisma,
  writer,
  user,
  org,
}: {
  prisma: PrismaClient;
  writer: GrantsLedgerWriter;
  user: { id: string; email: string; name: string };
  org: { id: string; name: string };
}): Promise<void> => {
  const pendingInvite = await InviteService.create(
    prisma,
  ).findPendingByOrgAndEmail({
    organizationId: org.id,
    email: user.email,
  });

  if (pendingInvite) {
    await InviteService.create(prisma).applyInvite({
      userId: user.id,
      invite: pendingInvite,
    });
    announceSsoAutoJoin({ user, org, inviteId: pendingInvite.id });
    return;
  }

  // The membership row is not a grant fact and keeps its imperative
  // write; the organization-scoped grant that comes with it is a ledger
  // command, emitted once the membership exists (ADR-092).
  try {
    await prisma.organizationUser.create({
      data: {
        userId: user.id,
        organizationId: org.id,
        role: "MEMBER",
      },
    });
  } catch (err) {
    // P2002 (unique constraint) on THIS insert means another concurrent
    // OAuth callback or a retry already created this membership. Idempotent
    // success. The catch guards the membership write alone — a P2002 from
    // any other constraint (an applied invite's rows, the grant below) is a
    // real failure and propagates instead of being logged as an
    // already-present membership.
    if (
      !(err instanceof Prisma.PrismaClientKnownRequestError) ||
      err.code !== "P2002"
    ) {
      throw err;
    }
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
  announceSsoAutoJoin({ user, org, inviteId: null });
};

/**
 * What happens to somebody a connection has never seen (ADR-117 §3).
 *
 * THE ANSWER EXISTED AND NOTHING ASKED IT. `arrivalPolicy` is written by the
 * setup journey, folded onto the connection and rendered back on two screens,
 * and no code on any sign-in path read it. better-auth's `sso()` plugin
 * creates the user and the account — its own comment says whether they then
 * land in the organization is "the connection's arrival policy and the join
 * policy's business, not this plugin's" — and nobody did that business.
 * `afterUserCreate` below is the only live auto-join and it matches the
 * LEGACY `Organization.ssoDomain` column, which a self-serve connection never
 * writes, so it returned early and every arrival was dropped in silence: an
 * account, no membership, no request, and nothing for an administrator to
 * answer.
 *
 * This is that business, at the seam where the account has just been linked
 * and the connection it arrived through is known — better-auth stores the
 * connection id as the account's provider, which is what makes an SSO arrival
 * distinguishable from every other OAuth account that passes through here.
 *
 * WHICH DOMAINS COUNT. Only the ones this connection PROVED, and not one
 * whose published record has lapsed: ADR-123's rule is that a lapsed domain
 * still ROUTES, so people who already work there keep signing in, and stops
 * PROVISIONING, so it admits nobody new.
 *
 * BEST EFFORT, LOUDLY. The sign-in has succeeded and the account is already
 * committed. Throwing would surface as "unable to create user" on a sign-in
 * that worked, so a failure is logged and swallowed — logged with the
 * connection and the domain, because an administrator asking "why is nobody
 * in my queue" needs this line to exist.
 */
/**
 * The answer this connection gives about somebody arriving on this domain, or
 * null when it gives none — which is most callers, because every provider the
 * deployment mounts passes through the same seam.
 *
 * WHICH DOMAINS COUNT. Only the ones this connection PROVED, and not one
 * whose published record has lapsed: ADR-123's rule is that a lapsed domain
 * still ROUTES, so people who already work there keep signing in, and stops
 * PROVISIONING, so it admits nobody new.
 */
/**
 * Whether an assertion from a customer's identity provider may become a
 * session at all — asked BEFORE better-auth links it to anybody.
 *
 * This is the only place that asks. `admitSsoArrival` below compares the
 * asserted domain against the connection's proved domains too, but it runs in
 * `account.create.after`, which is after the link has already happened, and it
 * decides organization membership rather than identity. That ordering was an
 * account takeover: `trustEmailVerified` makes `emailVerified` the CUSTOMER'S
 * OWN identity provider's word, better-auth links a verified address onto an
 * existing user, and a connection is dialable from DRAFT — so anybody who
 * could register a connection could point it at a server they control, assert
 * `someone-else@their-company.com` with `email_verified: true`, and be handed
 * that person's session.
 *
 * Two questions, and the second is why this is not simply "is the domain
 * proved":
 *
 *   - A LIVE connection may only assert addresses on domains it has proved.
 *     Nothing else is defensible; the proof is the entire basis for trusting
 *     the flag.
 *
 *   - A connection that is NOT live may only assert addresses that already
 *     belong to its own organization's members. This is not a loophole, it is
 *     the setup journey: activation refuses without a real sign-in through the
 *     connection (`SsoActivationTestSignInMissingError`), so the administrator
 *     doing the setup has to be able to sign in before the domain is proved.
 *     They are a member; an attacker asserting a stranger's address is not.
 *
 * The refusal is deliberately one code for every cause. Which of the two
 * questions failed is not something an unauthenticated caller gets to learn.
 */
export const ssoAssertionDecision = async ({
  prisma,
  providerId,
  email,
}: {
  prisma: PrismaClient;
  providerId: string;
  email: string | null | undefined;
}): Promise<{ action: "continue" } | { action: "reject"; code: string }> => {
  // A code the client registry already has words for; the words are the
  // ones a person who was refused at a customer's identity provider needs.
  const refuse = {
    action: "reject",
    code: "identity_sign_in_refused",
  } as const;
  const carryOn = { action: "continue" } as const;

  // Not a connection at all: the deployment's own brokered provider and the
  // generic OAuth path do not come through this plugin, and an id that is not
  // a connection's reaching it is not something to wave past.
  if (!looksLikeSsoConnectionId(providerId)) return refuse;

  const raw = extractEmailDomain(email);
  if (!raw) return refuse;
  // Folded the way a claimed domain is folded, or a trailing dot and a
  // unicode homograph both compare unequal to the domain they impersonate.
  const domain = normalizeDomain(raw);

  const connection = await prisma.ssoConnection.findUnique({
    where: { id: providerId },
    select: { organizationId: true, state: true, verifiedDomains: true },
  });
  if (!connection) return refuse;

  if (connection.state === "ACTIVE") {
    return connection.verifiedDomains.includes(domain) ? carryOn : refuse;
  }

  const member = await memberAtAddress({
    prisma,
    organizationId: connection.organizationId,
    email: email ?? "",
  });
  return member ? carryOn : refuse;
};

/**
 * Whether this address already belongs to somebody in this organization.
 *
 * Both places an address can live are asked, because the identity work moved
 * the truth to `Identifier` while `User.email` remains a copy for accounts the
 * backfill has not finalized (ADR-101 §5). Asking only one of them would make
 * the setup sign-in work for some administrators and not others.
 */
const memberAtAddress = async ({
  prisma,
  organizationId,
  email,
}: {
  prisma: PrismaClient;
  organizationId: string;
  email: string;
}): Promise<boolean> => {
  const address = email.trim().toLowerCase();
  if (!address) return false;
  const membership = await prisma.organizationUser.findFirst({
    where: {
      organizationId,
      OR: [
        { user: { email: { equals: address, mode: "insensitive" } } },
        {
          user: {
            identifiers: {
              some: { value: address, verifiedAt: { not: null } },
            },
          },
        },
      ],
    },
    select: { userId: true },
  });
  return membership !== null;
};

const arrivalDecisionFor = async ({
  prisma,
  connectionId,
  domain,
}: {
  prisma: PrismaClient;
  connectionId: string;
  domain: string;
}): Promise<{ policy: "admit" | "request"; organizationId: string } | null> => {
  // Cheap first: most accounts through this seam are not connections at all.
  if (!looksLikeSsoConnectionId(connectionId)) return null;
  const connection = await prisma.ssoConnection.findUnique({
    where: { id: connectionId },
    select: {
      organizationId: true,
      state: true,
      arrivalPolicy: true,
      verifiedDomains: true,
      lapsedDomains: true,
    },
  });
  if (!connection) return null;
  if (connection.state !== "ACTIVE") return null;
  if (!connection.verifiedDomains.includes(domain)) return null;
  if (connection.lapsedDomains.includes(domain)) return null;

  // Read off the connection rather than re-derived here. There is one field
  // and one answer, which is the point of there being one field: this is the
  // only reader for which the answer is an authorization decision, and it is
  // the last one that should be keeping a copy.
  const policy = connection.arrivalPolicy as SsoArrivalPolicy;
  if (policy !== "admit" && policy !== "request") return null;
  return { policy, organizationId: connection.organizationId };
};

export const admitSsoArrival = async ({
  prisma,
  writer,
  user,
  connectionId,
  domain,
}: {
  prisma: PrismaClient;
  writer: GrantsLedgerWriter;
  user: { id: string; email: string; name: string };
  connectionId: string;
  domain: string;
}): Promise<void> => {
  try {
    const decision = await arrivalDecisionFor({ prisma, connectionId, domain });
    if (!decision) return;
    const { organizationId } = decision;

    // Already one of them, which is every administrator testing their own
    // connection. Nothing to admit and nothing to ask about.
    const member = await prisma.organizationUser.findFirst({
      where: { userId: user.id, organizationId },
      select: { userId: true },
    });
    if (member) return;

    if (decision.policy === "request") {
      await joinRequestsService().requestFromSsoArrival({
        userId: user.id,
        organizationId,
        domain,
      });
      return;
    }

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    });
    if (org) await joinSsoOrganization({ prisma, writer, user, org });
  } catch (err) {
    // ORDINARY OUTCOMES ARE NOT INCIDENTS. A person who already has a request
    // in the queue, or whose domain the join rules will not match, is a
    // sentence about the world rather than something that went wrong — and a
    // fresh account row for somebody already waiting is routine (a provider
    // rotation, an unlink, the reconcile below). Logging those at `error`
    // buried the line an administrator is actually told to grep for when
    // their queue is empty.
    const expected = new Set([
      "join_request_already_pending",
      "join_not_available",
    ]);
    const code = (err as { code?: unknown } | null)?.code;
    if (typeof code === "string" && expected.has(code)) {
      logger.info(
        { code, userId: user.id, connectionId, domain },
        "an arrival through a single sign-on connection was not queued",
      );
      return;
    }
    logger.error(
      { err, userId: user.id, connectionId, domain },
      "an arrival through a single sign-on connection was not admitted (the sign-in still succeeded)",
    );
  }
};

/**
 * Called after a new user is created. Fires the `signed_up` analytics event
 * for every new user (fire-and-forget, no-op without POSTHOG_KEY), then, if
 * the user's email domain matches an organization with ssoDomain,
 * auto-onboard the user:
 *
 *   - If a PENDING invite exists for (org, email), apply it — the invite's
 *     role and team assignments take precedence, and the invite is marked
 *     ACCEPTED so it stops appearing as an outstanding link. This fixes the
 *     bug where an SSO signup bypassed an existing invite and landed the user
 *     in the org with only the default MEMBER role while the invite kept
 *     looking unused.
 *   - Otherwise, fall back to the default behavior and add them as MEMBER.
 *
 * The OrganizationUser row and the grant that comes with it can no longer
 * share a transaction: the membership is a table write and the grant is a
 * ledger command (ADR-092 delivery-plan PR 2). What replaces the transaction
 * is a re-assert — the grant write is idempotent, and the P2002 path in
 * `joinSsoOrganization`, which is a concurrent callback or a retry, runs it
 * again rather than assuming the other attempt got that far. Otherwise the
 * user is left "in the org" with no grant: org membership to legacy code,
 * zero access under RBAC.
 *
 * Outer catch: the whole auto-add is best-effort. If the write fails
 * outright (transient DB issue, concurrent signup we didn't catch via P2002),
 * we LOG and SWALLOW so the signup itself still succeeds — failing would
 * orphan the user (the User row was just committed by the preceding Prisma
 * adapter call) and surface as a confusing "unable to create user" error in
 * the OAuth callback. The user can always be added later via invite or admin
 * action, and the pendingSsoSetup + afterAccountUpdate self-heal path covers
 * re-attempts on subsequent sign-ins.
 *
 * ADR-027 (Decision 7, v5 MAJOR fix): this auto-join is federation — a login
 * capability — and runs on email+password signup too, not just OAuth. In a
 * denied (coerced-to-email) deployment with fresh signup open, an unverified
 * `POST /sign-up/email` at a customer's domain would otherwise auto-join
 * that org with zero IdP round-trip. Guarded on the SAME platform gate every
 * other provider rides — no per-org license check, just "is SSO allowed at
 * all on this deployment".
 */
export const afterUserCreate = async ({
  prisma,
  user,
  writer = grantsLedgerWriter(),
}: {
  prisma: PrismaClient;
  user: { id: string; email: string; name: string };
  /** Injectable so a test can watch the seam without a module mock. */
  writer?: GrantsLedgerWriter;
}): Promise<void> => {
  // Same distinct_id posthog-js identifies with client-side (the user id),
  // so this server event joins the browser person.
  trackServerEvent({ userId: user.id, event: "signed_up" });

  const domain = extractEmailDomain(user.email);
  if (!domain) return;

  // ADR-027 site #4: domain auto-join is federation and rides the platform
  // gate. When it denies (unlicensed deployment), skip the join — but log it,
  // because on an email-mode install the gate-resolution warning is suppressed
  // (sso-gate.ts), so a staff-set ssoDomain silently losing auto-join would
  // otherwise leave zero trace for an operator debugging "why wasn't this user
  // added to the org".
  const ssoAllowed = await platformSSOAllowed();
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
    const org = await prisma.organization.findUnique({
      where: { ssoDomain: domain },
    });
    if (!org) return;

    await joinSsoOrganization({ prisma, writer, user, org });
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

  // ADR-027: when the platform SSO gate denies, all ssoDomain enforcement is
  // off (site #4, mirroring `afterUserCreate`). Critically, this stops the
  // `pendingSsoSetup=true` soft-flag below from being written when the v6
  // reset-recovery path creates a `credential` account for an OAuth-born user
  // on an unlicensed install — that flag would otherwise strand them behind a
  // permanent "Link your SSO account" banner they can never clear (every SSO
  // path 403s on a denied deployment).
  if (!(await platformSSOAllowed())) {
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

  const org = await prisma.organization.findUnique({
    where: { ssoDomain: domain },
  });
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
 * Called after a new Account row is created. Runs the SSO reconciliation that
 * `beforeAccountCreate` used to perform inline, but deferred to this hook so
 * the cleanup only commits once the new Account row exists.
 *
 * Handles the two stale-row cases from the beforeAccountCreate comment:
 *   1) Same provider with a different providerAccountId (SSO subject rotated).
 *   2) A different OAuth provider (user had Google linked while the org's
 *      configured SSO is Auth0).
 *
 * Credential accounts (providerId = "credential") skip this entirely — on-prem
 * email-mode deployments don't configure SSO.
 */
export const afterAccountCreate = async ({
  prisma,
  account,
  writer = grantsLedgerWriter(),
}: {
  prisma: PrismaClient;
  account: { userId: string; providerId: string; accountId: string };
  /** Injectable so a test can watch the seam without a module mock. */
  writer?: GrantsLedgerWriter;
}): Promise<void> => {
  try {
    if (account.providerId === "credential") return;

    const user = await prisma.user.findUnique({
      where: { id: account.userId },
      select: { id: true, email: true, name: true },
    });
    if (!user?.email) return;

    const domain = extractEmailDomain(user.email);
    if (!domain) return;

    // THE CONNECTION'S OWN DOOR, asked before the legacy columns below and
    // independently of them. The two answer for different populations and a
    // self-serve connection never writes `ssoDomain`, so an arrival that
    // reaches this line has to be decided here or not at all.
    await admitSsoArrival({
      prisma,
      writer,
      user: { id: user.id, email: user.email, name: user.name ?? "" },
      connectionId: account.providerId,
      domain,
    });

    const org = await prisma.organization.findUnique({
      where: { ssoDomain: domain },
    });
    if (!org) return;

    const matchesSso = isSsoProviderMatch(org, {
      providerId: account.providerId,
      accountId: account.accountId,
    });
    if (!matchesSso) return;

    await reconcileSsoAccounts({
      prisma,
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
      select: {
        id: true,
        email: true,
        name: true,
        pendingSsoSetup: true,
      },
    });
    if (!user?.email) return;

    const domain = extractEmailDomain(user.email);
    if (!domain) return;

    // ASKED ON EVERY SIGN-IN, not only the first.
    //
    // The arrival decision refuses a connection that is not yet ACTIVE, and
    // this hook is the only one that runs on a RETURNING sign-in — the
    // account row already exists, so `account.create.after` never fires
    // again. Deciding arrivals only there meant everybody who signed in
    // during setup was decided once, while the answer was still "not live",
    // and never again: an account, no membership, no request, and an empty
    // queue on the administrator's screen. That includes the administrator
    // who performed the test sign-in activation refuses to go without.
    //
    // Idempotent, so asking every time costs a read: it returns early on an
    // existing membership, and the join guard refuses a duplicate request.
    await admitSsoArrival({
      prisma,
      writer: grantsLedgerWriter(),
      user: { id: user.id, email: user.email, name: user.name ?? "" },
      connectionId: account.providerId,
      domain,
    });

    if (!user.pendingSsoSetup) return;

    const org = await prisma.organization.findUnique({
      where: { ssoDomain: domain },
    });
    if (!org) return;

    const matchesSso = isSsoProviderMatch(org, {
      providerId: account.providerId,
      accountId: account.accountId,
    });
    if (!matchesSso) return;

    await reconcileSsoAccounts({
      prisma,
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
    logger.warn(
      { userId: session.userId },
      "Blocked session create: user deactivated",
    );
    return false;
  }
};

/**
 * Called after a Session is created. Updates User.lastLoginAt and fires
 * fire-and-forget nurturing hooks. The lastLoginAt update is awaited so the
 * invariant holds immediately for subsequent requests on the same session.
 * Ported from the NextAuth session callback.
 *
 * Skipped entirely when the session is an admin-impersonation session — we
 * don't want an admin's activity to ghost-write the target user's lastLoginAt.
 * In practice no impersonation reaches here at all: starting one writes the
 * `{actor, subject}` claims onto the operator's EXISTING session rather than
 * minting a new one (D06), so this hook only ever sees real sign-ins. The
 * parameter survives for callers that mint a session on somebody's behalf.
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
  fireActivityTrackingNurturing: (args: {
    userId: string;
    hasOrganization: boolean;
  }) => void;
  ensureUserSyncedToCio: (args: {
    userId: string;
    hasOrganization: boolean;
  }) => void;
}): Promise<void> => {
  // lastLoginAt is only updated for "real" sessions — not admin impersonation.
  if (!isImpersonationSession) {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { lastLoginAt: new Date() },
      });
    } catch (err) {
      logger.error(
        { err, userId },
        "Failed to update lastLoginAt after session create",
      );
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
      logger.error(
        { err, userId },
        "Failed to fire nurturing hooks after session create",
      );
    });
};
