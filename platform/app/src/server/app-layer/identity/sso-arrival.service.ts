import { SYSTEM_ACTORS } from "@langwatch/actor";
import type { SsoArrivalPolicy } from "@langwatch/identity";
import { looksLikeSsoConnectionId } from "@langwatch/identity-server";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { KSUID_RESOURCES } from "~/utils/constants";
import type { GrantsLedgerWriter } from "../authz/ledger";
import {
  domainStanding,
  type SignInConnectionReadsPort,
} from "./sso-assertion.service";

const logger = createLogger("langwatch:identity:sso-arrival");

/** The person arriving, as every step of an auto-join names them. */
export interface ArrivingUser {
  id: string;
  email: string;
  name: string;
}

/** The organization they land in. */
export interface JoinedOrganization {
  id: string;
  name: string;
}

export interface SsoMembershipPort {
  /** Whether this person already holds a membership here. */
  findMembership(args: {
    userId: string;
    organizationId: string;
  }): Promise<boolean>;
  /**
   * Makes them a MEMBER. Answers `"already-present"` rather than throwing
   * when the row is already there — a concurrent OAuth callback or a retry
   * created it, which is idempotent success and not a failure.
   */
  createMembership(args: {
    userId: string;
    organizationId: string;
  }): Promise<"created" | "already-present">;
  /** The organization a membership would be created in, as the announcement
   *  names it. */
  findOrganizationForMembership(args: {
    organizationId: string;
  }): Promise<JoinedOrganization | null>;
}

export interface SsoArrivalInvitesPort {
  /**
   * Applies the PENDING invite this address already holds for this
   * organization, and answers which one it was; null when there is none.
   *
   * One verb rather than find-then-apply, because the pair is one decision:
   * an invite that exists is the invite that wins, and its role and team
   * assignments replace the default membership entirely.
   */
  applyPendingInvite(args: {
    userId: string;
    organizationId: string;
    email: string;
  }): Promise<{ inviteId: string } | null>;
}

export interface SsoJoinRequestsPort {
  requestFromSsoArrival(args: {
    userId: string;
    organizationId: string;
    domain: string;
  }): Promise<{ joinRequestId: string } | null>;
}

export interface SsoArrivalNotificationsPort {
  /** Tells the team somebody signed up through a domain rule. */
  announceSignup(args: {
    userName: string;
    userEmail: string;
    organizationName: string;
  }): void;
  /** Starts the nurturing sequence an auto-added member gets. */
  startNurturing(args: {
    userId: string;
    email: string;
    name: string;
    organizationId: string;
    organizationName: string;
  }): void;
}

/** The grant writer, as an arrival needs it: one verb. */
export type SsoArrivalGrantsPort = Pick<GrantsLedgerWriter, "attachBindings">;

export interface SsoArrivalServiceDeps {
  connections: SignInConnectionReadsPort;
  memberships: SsoMembershipPort;
  invites: SsoArrivalInvitesPort;
  joinRequests: SsoJoinRequestsPort;
  grants: SsoArrivalGrantsPort;
  notifications: SsoArrivalNotificationsPort;
}

/**
 * What happens to somebody a connection has never seen (ADR-117 §3), and what
 * happens to somebody whose address domain a legacy `Organization.ssoDomain`
 * claims.
 *
 * THE ANSWER EXISTED AND NOTHING ASKED IT. `arrivalPolicy` is written by the
 * setup journey, folded onto the connection and rendered back on two screens,
 * and no code on any sign-in path read it. better-auth's `sso()` plugin
 * creates the user and the account — its own comment says whether they then
 * land in the organization is "the connection's arrival policy and the join
 * policy's business, not this plugin's" — and nobody did that business. The
 * only live auto-join matched the LEGACY `Organization.ssoDomain` column,
 * which a self-serve connection never writes, so it returned early and every
 * arrival was dropped in silence: an account, no membership, no request, and
 * nothing for an administrator to answer.
 */
export class SsoArrivalService {
  constructor(private readonly deps: SsoArrivalServiceDeps) {}

  /**
   * The connection's own door, asked at the seam where the account has just
   * been linked and the connection it arrived through is known — better-auth
   * stores the connection id as the account's provider, which is what makes an
   * SSO arrival distinguishable from every other OAuth account that passes
   * through here.
   *
   * BEST EFFORT, LOUDLY. The sign-in has succeeded and the account is already
   * committed. Throwing would surface as "unable to create user" on a sign-in
   * that worked, so a failure is logged and swallowed — logged with the
   * connection and the domain, because an administrator asking "why is nobody
   * in my queue" needs this line to exist.
   */
  async admit({
    user,
    connectionId,
    domain,
  }: {
    user: ArrivingUser;
    connectionId: string;
    domain: string;
  }): Promise<void> {
    try {
      const decision = await this.arrivalDecisionFor({ connectionId, domain });
      if (!decision) return;
      const { organizationId } = decision;

      // Already one of them, which is every administrator testing their own
      // connection. Nothing to admit and nothing to ask about.
      const member = await this.deps.memberships.findMembership({
        userId: user.id,
        organizationId,
      });
      if (member) return;

      if (decision.policy === "request") {
        await this.deps.joinRequests.requestFromSsoArrival({
          userId: user.id,
          organizationId,
          domain,
        });
        return;
      }

      const org = await this.deps.memberships.findOrganizationForMembership({
        organizationId,
      });
      if (org) await this.joinOrganization({ user, org });
    } catch (err) {
      // ORDINARY OUTCOMES ARE NOT INCIDENTS. A person who already has a request
      // in the queue, or whose domain the join rules will not match, is a
      // sentence about the world rather than something that went wrong — and a
      // fresh account row for somebody already waiting is routine (a provider
      // rotation, an unlink, the account reconcile). Logging those at `error`
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
  }

  /**
   * Membership + grant for one domain-matched organization. A pending invite
   * wins when one exists (its role and team assignments carry their own
   * grants); otherwise the default MEMBER membership plus the organization-
   * scoped grant beside it.
   *
   * A membership row that was already there means a concurrent OAuth callback
   * or a retry created it first — treated as success, with the grant
   * re-asserted rather than assumed, because the concurrent callback may have
   * died between the two writes.
   */
  async joinOrganization({
    user,
    org,
  }: {
    user: ArrivingUser;
    org: JoinedOrganization;
  }): Promise<void> {
    const applied = await this.deps.invites.applyPendingInvite({
      userId: user.id,
      organizationId: org.id,
      email: user.email,
    });
    if (applied) {
      this.announceAutoJoin({ user, org, inviteId: applied.inviteId });
      return;
    }

    // The membership row is not a grant fact and keeps its imperative
    // write; the organization-scoped grant that comes with it is a ledger
    // command, emitted once the membership exists (ADR-092).
    const outcome = await this.deps.memberships.createMembership({
      userId: user.id,
      organizationId: org.id,
    });

    if (outcome === "already-present") {
      logger.info(
        { userId: user.id, organizationId: org.id },
        "Auto-add SSO membership was already present — treating as success",
      );
      // The membership row existing says nothing about the grant beside it:
      // the concurrent callback that created it may have died in between,
      // and the two writes no longer share a transaction. Re-assert, which
      // is a no-op when the other attempt finished.
      await this.grantDefaultMembership({
        organizationId: org.id,
        userId: user.id,
      });
      return;
    }

    await this.grantDefaultMembership({
      organizationId: org.id,
      userId: user.id,
    });
    this.announceAutoJoin({ user, org, inviteId: null });
  }

  /**
   * Which answer this connection gives about somebody arriving on this
   * domain, or null when it gives none — which is most callers, because every
   * provider the deployment mounts passes through the same seam.
   *
   * WHICH DOMAINS COUNT. Only the ones this connection PROVED, and not one
   * whose published record has lapsed: ADR-123's rule is that a lapsed domain
   * still ROUTES, so people who already work there keep signing in, and stops
   * PROVISIONING, so it admits nobody new.
   */
  private async arrivalDecisionFor({
    connectionId,
    domain,
  }: {
    connectionId: string;
    domain: string;
  }): Promise<{
    policy: "admit" | "request";
    organizationId: string;
  } | null> {
    // Cheap first: most accounts through this seam are not connections at all.
    if (!looksLikeSsoConnectionId(connectionId)) return null;
    const connection = await this.deps.connections.findConnectionForSignIn({
      connectionId,
    });
    if (!connection) return null;

    const standing = domainStanding({ connection, domain });
    if (!standing.live) return null;
    if (!standing.proved) return null;
    if (standing.lapsed) return null;

    // Read off the connection rather than re-derived here. There is one field
    // and one answer, which is the point of there being one field: this is the
    // only reader for which the answer is an authorization decision, and it is
    // the last one that should be keeping a copy.
    const policy = connection.arrivalPolicy as SsoArrivalPolicy;
    if (policy !== "admit" && policy !== "request") return null;
    return { policy, organizationId: connection.organizationId };
  }

  /**
   * The organization-scoped grant that comes with a default membership.
   * Idempotent by construction: an identical row already present is skipped,
   * so calling this twice grants nothing twice, and calling it after a
   * membership row turned up on its own is the repair.
   */
  private grantDefaultMembership({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<unknown> {
    return this.deps.grants.attachBindings({
      organizationId,
      bindings: [
        {
          bindingId: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          principal: { userId },
          role: "MEMBER",
          customRoleId: null,
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
        },
      ],
      // The signup is the product acting on a domain rule, not an
      // administrator granting access.
      actor: { type: "system", id: SYSTEM_ACTORS.ssoAutoJoin },
      onDuplicate: "skip",
    });
  }

  /**
   * Success-side announcements once the membership landed: the log line, the
   * signup event and the nurturing calls, both fire-and-forget behind their
   * port.
   */
  private announceAutoJoin({
    user,
    org,
    inviteId,
  }: {
    user: ArrivingUser;
    org: JoinedOrganization;
    inviteId: string | null;
  }): void {
    logger.info(
      { userId: user.id, organizationId: org.id, inviteId },
      inviteId
        ? "Applied pending invite on SSO signup"
        : "Auto-added new user to SSO organization (default MEMBER)",
    );

    this.deps.notifications.announceSignup({
      userName: user.name,
      userEmail: user.email,
      organizationName: org.name,
    });

    this.deps.notifications.startNurturing({
      userId: user.id,
      email: user.email,
      name: user.name,
      organizationId: org.id,
      organizationName: org.name,
    });
  }
}
