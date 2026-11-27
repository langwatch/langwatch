import type { OrganizationInviteFact } from "@langwatch/organization-contract";
import { nowInstant } from "@langwatch/time";

import type { OrganizationInviteRepository } from "../../../repositories/organization-invite.repository.ts";
import { resolveInviteDisplayStatus } from "../../../rules/invite-display-status.rules.ts";

/**
 * Every invitation of an organization as a staff investigation reads it (ADR-202, ops
 * functions): the status a person sees, ids, flags and times. The address, the code and the
 * accept link never leave this service.
 */
export class OrganizationInviteFactsService {
  static create(dependencies: {
    invites: Pick<OrganizationInviteRepository, "findAllInvites">;
  }): OrganizationInviteFactsService {
    return new OrganizationInviteFactsService(dependencies);
  }

  private constructor(
    private readonly dependencies: {
      invites: Pick<OrganizationInviteRepository, "findAllInvites">;
    },
  ) {}

  async findFacts({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationInviteFact[]> {
    const invites = await this.dependencies.invites.findAllInvites({ organizationId });
    const nowMs = nowInstant().epochMilliseconds;
    return invites.map((invite) => ({
      inviteId: invite.id,
      role: invite.role,
      status: resolveInviteDisplayStatus(invite, nowMs),
      billingOnly: invite.billingOnly ?? false,
      viaCheckout: invite.subscriptionId !== null,
      teamIds: invite.teamIds
        .split(",")
        .map((teamId) => teamId.trim())
        .filter((teamId) => teamId !== ""),
      requestedByUserId: invite.requestedBy,
      acceptedByUserId: invite.acceptedByUserId,
      createdAt: invite.createdAt.epochMilliseconds,
      updatedAt: invite.updatedAt.epochMilliseconds,
      expiresAt: invite.expiration?.epochMilliseconds ?? null,
    }));
  }
}
