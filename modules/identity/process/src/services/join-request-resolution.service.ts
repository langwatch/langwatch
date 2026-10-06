import { SYSTEM_ACTORS } from "@langwatch/authorization";
import { HandledError } from "@langwatch/handled-error";
import { JoinRequestNotFoundError } from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";

import { approveJoinCommandId, newJoinRequestCommandId } from "../rules/join-request-id.rules.ts";
import type { JoinRequestsServiceDeps } from "../rules/join-requests-contract.rules.ts";
import type { JoinRequestAdmissionGuardsService } from "./join-request-admission-guards.service.ts";

const logger = createLogger("langwatch:identity:join-requests");

/** How an open join request ends: an admin, the requester, an invitation or the domain policy. */
export class JoinRequestResolutionService {
  static create(
    deps: JoinRequestsServiceDeps,
    guards: JoinRequestAdmissionGuardsService,
    now: () => number,
  ): JoinRequestResolutionService {
    return new JoinRequestResolutionService(deps, guards, now);
  }

  private constructor(
    private readonly deps: JoinRequestsServiceDeps,
    private readonly guards: JoinRequestAdmissionGuardsService,
    private readonly now: () => number,
  ) {}

  /** An admin says yes. There is no role on this call and never will be. */
  async approve({
    joinRequestId,
    organizationId,
    adminUserId,
  }: {
    joinRequestId: string;
    organizationId: string;
    adminUserId: string;
  }): Promise<void> {
    const request = await this.guards.ownedRequestOrRefuse({
      joinRequestId,
      organizationId,
    });
    await this.resolveApproved({
      joinRequestId,
      organizationId,
      userId: request.userId,
      resolvedBy: { type: "user", id: adminUserId },
      actor: { type: "user", id: adminUserId },
      approvedByUserId: adminUserId,
      occurredAtMs: this.now(),
    });
  }

  /** An admin says no, without being asked why. */
  async reject({
    joinRequestId,
    organizationId,
    adminUserId,
  }: {
    joinRequestId: string;
    organizationId: string;
    adminUserId: string;
  }): Promise<void> {
    await this.guards.ownedRequestOrRefuse({
      joinRequestId,
      organizationId,
    });
    await this.deps.requests.rejectJoin({
      tenantId: organizationId,
      organizationId,
      joinRequestId,
      commandId: newJoinRequestCommandId(),
      occurredAtMs: this.now(),
      actor: { type: "user", id: adminUserId },
      resolvedBy: { type: "user", id: adminUserId },
    });
  }

  /** The requester giving up, so nobody is bothered further. */
  async withdraw({
    joinRequestId,
    userId,
  }: {
    joinRequestId: string;
    userId: string;
  }): Promise<void> {
    const request = await this.deps.reads.getRequest({ joinRequestId });
    if (request.userId !== userId) {
      throw new JoinRequestNotFoundError(
        `join request ${joinRequestId} is not ${userId}'s to withdraw`,
      );
    }

    await this.deps.requests.withdrawJoin({
      tenantId: request.organizationId,
      organizationId: request.organizationId,
      joinRequestId,
      commandId: newJoinRequestCommandId(),
      occurredAtMs: this.now(),
      actor: { type: "user", id: userId },
      cause: "user",
    });
  }

  /**
   * D11 crossing point, invitation → request: sending a formal invitation to somebody with an open
   * request ANSWERS it. The invitation carries the role and the teams, which is the flow that owns
   * them.
   */
  async resolveByInvitation({
    userId,
    organizationId,
    inviteId,
  }: {
    userId: string;
    organizationId: string;
    inviteId: string;
  }): Promise<void> {
    const open = await this.deps.reads
      .getPendingRequest({ userId, organizationId })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "join_request_not_found")
          return undefined;
        throw error;
      });
    if (!open) {
      return;
    }

    await this.deps.requests.approveJoin({
      tenantId: organizationId,
      organizationId,
      joinRequestId: open.joinRequestId,
      commandId: approveJoinCommandId({
        joinRequestId: open.joinRequestId,
        resolvedByType: "invite",
        resolvedById: inviteId,
      }),
      occurredAtMs: this.now(),
      actor: { type: "system", id: SYSTEM_ACTORS.joinRequests },
      resolvedBy: { type: "invite", id: inviteId },
    });
    // No membership attach here: the invitation's own acceptance does that,
    // with the role and teams IT carries. This only closes the request so a
    // person never holds both.
  }

  /**
   * D11 crossing point, acceptance → request: accepting any invitation
   * withdraws the same person's open request for that organization, so the
   * membership lands exactly once and the admins' panel empties itself.
   */
  async withdrawOnInvitationAccepted({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    const open = await this.deps.reads
      .getPendingRequest({ userId, organizationId })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "join_request_not_found")
          return undefined;
        throw error;
      });
    if (!open) {
      return;
    }

    await this.deps.requests.withdrawJoin({
      tenantId: organizationId,
      organizationId,
      joinRequestId: open.joinRequestId,
      commandId: newJoinRequestCommandId(),
      occurredAtMs: this.now(),
      actor: { type: "system", id: SYSTEM_ACTORS.joinRequests },
      cause: "invite-accepted",
    });
  }

  /**
   * The approval's two halves: state the fact, then attach the membership. They are separate on
   * purpose and in this order.
   */
  async resolveApproved({
    joinRequestId,
    organizationId,
    userId,
    resolvedBy,
    actor,
    approvedByUserId,
    occurredAtMs,
  }: {
    joinRequestId: string;
    organizationId: string;
    userId: string;
    resolvedBy: { type: "user" | "policy" | "invite"; id: string };
    actor: { type: "user" | "system"; id: string };
    approvedByUserId: string | null;
    occurredAtMs: number;
  }): Promise<void> {
    await this.deps.requests.approveJoin({
      tenantId: organizationId,
      organizationId,
      joinRequestId,
      // Derived, not minted: a retry after a partial failure has to be the
      // SAME command, or it would state a second approval on a request that
      // already has one.
      commandId: approveJoinCommandId({
        joinRequestId,
        resolvedByType: resolvedBy.type,
        resolvedById: resolvedBy.id,
      }),
      occurredAtMs,
      actor,
      resolvedBy,
    });

    if (await this.deps.membership.isMember({ userId, organizationId })) {
      logger.info(
        { joinRequestId, organizationId },
        "join request approved for somebody who was already a member; no second membership attached",
      );

      return;
    }

    await this.deps.membership.attachDefaultMembership({
      userId,
      organizationId,
      joinRequestId,
      commandId: approveJoinCommandId({
        joinRequestId,
        resolvedByType: resolvedBy.type,
        resolvedById: resolvedBy.id,
      }),
      approvedByUserId,
    });
  }
}
