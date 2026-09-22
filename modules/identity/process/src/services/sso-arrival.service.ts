import { SYSTEM_ACTORS } from "@langwatch/actor";
import { type AuthzApi, AuthzGrantNotConfirmedError } from "@langwatch/authz-contract";
import {
  looksLikeSsoConnectionId,
  type SsoArrivalPolicy,
  ssoDomainStanding,
} from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";

import type { SsoConnectionReadRepository } from "../repositories/sso-connection.repository.ts";
import type {
  ArrivingUser,
  JoinedOrganization,
  SsoArrivalIdentityAdoption,
  SsoArrivalJoinRequests,
  SsoArrivalMemberships,
  SsoArrivalNotifications,
} from "../rules/sso-arrival-contract.rules.ts";

const logger = createLogger("langwatch:identity:sso-arrival");

/** Duplicate and ineligible join requests are ordinary arrival outcomes. */
const ROUTINE_REFUSALS = new Set(["join_request_already_pending", "join_not_available"]);

export interface SsoArrivalServiceDeps {
  connections: SsoConnectionReadRepository;
  memberships: SsoArrivalMemberships;
  authz: AuthzApi;
  joinRequests: SsoArrivalJoinRequests;
  notifications: SsoArrivalNotifications;
  adoption: SsoArrivalIdentityAdoption;
}

/**
 * Applies a connection's arrival answer after authentication, then adopts an
 * admitted member. The account and session are already committed, so an
 * admission that fails is reported, never turned into a refused sign-in.
 */
export class SsoArrivalService {
  static create(deps: SsoArrivalServiceDeps): SsoArrivalService {
    return new SsoArrivalService(deps);
  }

  private constructor(private readonly deps: SsoArrivalServiceDeps) {}

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

      if (await this.deps.memberships.isMember({ organizationId, userId: user.id })) {
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

      const organization = await this.deps.memberships.findOrganization({ organizationId });
      if (organization) {
        await this.joinOrganization({ user, org: organization, domain });
        await this.adoptIdentity(user.id);
      }
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (typeof code === "string" && ROUTINE_REFUSALS.has(code)) {
        logger.info(
          { code, userId: user.id, connectionId, domain },
          "an arrival through a single sign-on connection was not queued",
        );
        return;
      }
      logger.error(
        { error, userId: user.id, connectionId, domain },
        "an arrival through a single sign-on connection was not admitted (the sign-in still succeeded)",
      );
    }
  }

  /** A pending invitation wins; otherwise a membership carrying a durable
   *  grant intent, which the admission is resumed from. */
  async joinOrganization({
    user,
    org,
    domain,
  }: {
    user: ArrivingUser;
    org: JoinedOrganization;
    domain: string;
  }): Promise<void> {
    const invite = await this.deps.memberships.applyPendingInvite({
      userId: user.id,
      organizationId: org.id,
      email: user.email,
    });
    if (invite.applied) {
      this.announceAutoJoin({ user, org, inviteId: invite.inviteId });
      return;
    }

    await this.deps.memberships.createMembership({ organizationId: org.id, userId: user.id });
    await this.resumeAdmission({ user, organizationId: org.id, domain });
  }

  /**
   * Finishes whatever the last attempt left behind, reusing the original
   * identity and timestamp so a retry re-emits the same fact. A retry can
   * never revive a grant somebody revoked.
   */
  private async resumeAdmission({
    user,
    organizationId,
    domain,
  }: {
    user: ArrivingUser;
    organizationId: string;
    domain: string;
  }): Promise<void> {
    const scope = { organizationId, userId: user.id };
    let read = await this.deps.authz.readPendingAdmission(scope);
    if (!read.pending) return;

    if (read.admission.state === "pending") {
      await this.grantDefaultMembership({ ...scope, ...read.admission });
      read = await this.deps.authz.readPendingAdmission(scope);
      if (!read.pending) return;
      if (read.admission.state === "pending") throw new AuthzGrantNotConfirmedError();
    }
    if (read.admission.state === "revoked") {
      await this.deps.authz.clearPendingAdmission({ ...scope, grantId: read.admission.grantId });
      return;
    }

    const org = await this.deps.memberships.findOrganization({ organizationId });
    if (!org) return;
    await this.deps.notifications.joinedAutomatically({
      organizationId,
      requesterUserId: user.id,
      domain,
      admissionId: read.admission.grantId,
    });

    // The durable handoff stays AHEAD of clearing the marker: if this process
    // stops after it, the next arrival retries the same append and
    // completion; if the handoff fails, the marker is still the retry signal.
    const completed = await this.deps.authz.completeAdmission({
      ...scope,
      grantId: read.admission.grantId,
    });
    if (!completed) return;
    this.announceAutoJoin({ user, org, inviteId: null });
  }

  private async adoptIdentity(userId: string): Promise<void> {
    await this.deps.adoption.adopt({ userId });
  }

  /**
   * Which answer this connection gives about somebody arriving on this
   * domain, or null when it gives none. Only domains it PROVED count, and not
   * one whose record lapsed: a lapse routes and provisions nobody (ADR-123).
   */
  private async arrivalDecisionFor({
    connectionId,
    domain,
  }: {
    connectionId: string;
    domain: string;
  }): Promise<{ policy: SsoArrivalPolicy; organizationId: string } | null> {
    // Cheap first: most accounts through this seam are not connections at all.
    if (!looksLikeSsoConnectionId(connectionId)) return null;
    const connection = await this.deps.connections.tryFindConnection({ connectionId });
    if (!connection) return null;

    const standing = ssoDomainStanding({ connection, domain });
    if (!standing.live || !standing.proved || standing.lapsed) return null;

    // Read off the connection rather than re-derived here: there is one field
    // and one answer, and this is the last reader that should keep a copy.
    return { policy: connection.arrivalPolicy, organizationId: connection.organizationId };
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
    return this.deps.authz.attachBindings({
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

  /** The success-side announcements once the membership landed. */
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
