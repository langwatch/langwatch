// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { SYSTEM_ACTORS } from "@langwatch/actor";
import {
  looksLikeSsoConnectionId,
  type SsoArrivalPolicy,
} from "@langwatch/identity";
import { createLogger } from "@langwatch/observability";
import { AuthzGrantNotConfirmedError } from "~/server/app-layer/authz/errors";
import type { GrantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "~/server/app-layer/identity/migration-name";
import type { SystemMigrationsService } from "~/server/app-layer/system-migrations/system-migrations.service";
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

export interface PendingSsoAdmission {
  grantId: string;
  occurredAtMs: number;
  state: "pending" | "applied" | "revoked";
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
  findPendingAdmission(args: {
    userId: string;
    organizationId: string;
  }): Promise<PendingSsoAdmission | null>;
  completeAdmission(args: {
    userId: string;
    organizationId: string;
    grantId: string;
  }): Promise<boolean>;
  /** Clears a revoked admission marker without treating the admission as successful. */
  clearPendingAdmission(args: {
    userId: string;
    organizationId: string;
    grantId: string;
  }): Promise<boolean>;
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
  joinedAutomatically(args: {
    organizationId: string;
    requesterUserId: string;
    domain: string;
    admissionId: string;
  }): Promise<void>;
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
  migrations: SystemMigrationsService;
  connections: SignInConnectionReadsPort;
  memberships: SsoMembershipPort;
  invites: SsoArrivalInvitesPort;
  joinRequests: SsoJoinRequestsPort;
  grants: SsoArrivalGrantsPort;
  notifications: SsoArrivalNotificationsPort;
}

/** Applies a connection's arrival policy after authentication, then adopts
 * an admitted member through the normal identity migration. */
export class SsoArrivalService {
  constructor(private readonly deps: SsoArrivalServiceDeps) {}

  /** The account and session are already committed. Admission failures are
   * reported without turning the completed authentication into a refusal. */
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

      const member = await this.deps.memberships.findMembership({
        userId: user.id,
        organizationId,
      });
      if (member) {
        await this.resumeAdmission({ user, organizationId, domain });
        await this.adoptIdentity(user.id);
        return;
      }
      if (decision.policy === "refuse") return;

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
      if (org) {
        await this.joinOrganization({ user, org, domain });
        await this.adoptIdentity(user.id);
      }
    } catch (err) {
      // Duplicate or ineligible join requests are normal arrival outcomes.
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

  /** A pending invite wins; otherwise create membership with a durable grant intent. */
  async joinOrganization({
    user,
    org,
    domain,
  }: {
    user: ArrivingUser;
    org: JoinedOrganization;
    domain: string;
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

    await this.deps.memberships.createMembership({
      userId: user.id,
      organizationId: org.id,
    });

    await this.resumeAdmission({ user, organizationId: org.id, domain });
  }

  private async resumeAdmission({
    user,
    organizationId,
    domain,
  }: {
    user: ArrivingUser;
    organizationId: string;
    domain: string;
  }): Promise<void> {
    const scope = { userId: user.id, organizationId };
    let pending = await this.deps.memberships.findPendingAdmission(scope);
    if (!pending) return;

    // Reuse the original identity and timestamp. A retry cannot revive a revoked grant.
    if (pending.state === "pending") {
      await this.grantDefaultMembership({ ...scope, ...pending });
      pending = await this.deps.memberships.findPendingAdmission(scope);
      if (!pending) return;
      if (pending.state === "pending") throw new AuthzGrantNotConfirmedError();
    }
    if (pending.state === "revoked") {
      await this.deps.memberships.clearPendingAdmission({
        ...scope,
        grantId: pending.grantId,
      });
      return;
    }

    const org = await this.deps.memberships.findOrganizationForMembership({
      organizationId,
    });
    if (!org) return;
    await this.deps.notifications.joinedAutomatically({
      organizationId,
      requesterUserId: user.id,
      domain,
      admissionId: pending.grantId,
    });

    // Keep the durable notification handoff ahead of clearing the admission
    // marker. If this process stops after the handoff, the next SSO arrival
    // retries the same append and completion; if the handoff fails, the
    // pending marker remains the retry signal.
    const completed = await this.deps.memberships.completeAdmission({
      ...scope,
      grantId: pending.grantId,
    });
    if (!completed) return;
    this.announceAutoJoin({ user, org, inviteId: null });
  }

  private async adoptIdentity(userId: string): Promise<void> {
    const { status } = await this.deps.migrations.runForUser({
      userId,
      migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
    });
    if (status === "migrated" || status === "parked") {
      logger.warn(
        { userId, status },
        "SSO identity adoption remains pending; a later sign-in retries it",
      );
    }
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
    policy: SsoArrivalPolicy;
    organizationId: string;
  } | null> {
    // Cheap first: most accounts through this seam are not connections at all,
    // so this is the expected path and reads at debug, not one line per
    // ordinary sign-in.
    if (!looksLikeSsoConnectionId(connectionId)) {
      logger.debug(
        { reason: "not_a_connection_id", connectionId },
        "a single sign-on arrival was not considered for admission",
      );
      return null;
    }
    const connection = await this.deps.connections.findConnectionForSignIn({
      connectionId,
    });
    if (!connection) {
      logger.info(
        { reason: "connection_not_found", connectionId },
        "a single sign-on arrival was not considered for admission",
      );
      return null;
    }

    const standing = domainStanding({ connection, domain });
    if (!standing.live) {
      logger.info(
        {
          reason: "domain_not_live",
          connectionId,
          organizationId: connection.organizationId,
        },
        "a single sign-on arrival was not considered for admission",
      );
      return null;
    }
    if (!standing.proved) {
      logger.info(
        {
          reason: "domain_not_proved",
          connectionId,
          organizationId: connection.organizationId,
        },
        "a single sign-on arrival was not considered for admission",
      );
      return null;
    }
    if (standing.lapsed) {
      logger.info(
        {
          reason: "domain_proof_lapsed",
          connectionId,
          organizationId: connection.organizationId,
        },
        "a single sign-on arrival was not considered for admission",
      );
      return null;
    }

    // Read off the connection rather than re-derived here. There is one field
    // and one answer, which is the point of there being one field: this is the
    // only reader for which the answer is an authorization decision, and it is
    // the last one that should be keeping a copy.
    const policy = connection.arrivalPolicy as SsoArrivalPolicy;
    if (policy !== "admit" && policy !== "request" && policy !== "refuse")
      return null;
    return { policy, organizationId: connection.organizationId };
  }

  /** An admission retry re-emits the same fact, including its idempotency key. */
  private grantDefaultMembership({
    organizationId,
    userId,
    grantId,
    occurredAtMs,
  }: {
    organizationId: string;
    userId: string;
    grantId: string;
    occurredAtMs: number;
  }): Promise<unknown> {
    return this.deps.grants.attachBindings({
      organizationId,
      bindings: [
        {
          bindingId: grantId,
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
      commandId: `sso-admission:${grantId}`,
      occurredAtMs,
      requireProjection: true,
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
