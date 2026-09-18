/**
 * How many invitations one sender may create in an hour, resolved on the
 * invited-to organization's plan (D11's sibling: that throttle is per
 * invitation, this one is per sender and per address invited).
 */
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { InvitesRateLimitedError } from "@langwatch/organization-contract";
import { nowInstant } from "@langwatch/time";

import type { OrganizationInviteRateLimit } from "../app/organization.members.ts";

export const INVITE_CREATION_WINDOW_SECONDS = 60 * 60;

/**
 * The window, spent against whichever counter the process composed. Keyed on
 * the SENDER, not the organization: an admin hopping projects must not reset
 * it, and a batch spends one per invited address, not one per request.
 */
export class InviteCreationThrottleService {
  static create(deps: {
    rateLimit: OrganizationInviteRateLimit;
    plans: Pick<EntitlementApi, "requestBound">;
  }): InviteCreationThrottleService {
    return new InviteCreationThrottleService(deps);
  }

  private constructor(
    private readonly deps: Readonly<{
      rateLimit: OrganizationInviteRateLimit;
      plans: Pick<EntitlementApi, "requestBound">;
    }>,
  ) {}

  /**
   * Spends `count` creations against the sender's window, at the bound the
   * invited-to organization's plan resolves. Refused attempts still spend:
   * the counter is the abuse door, not a usage meter.
   */
  async assertCreationAllowed({
    organizationId,
    senderUserId,
    count,
    now = nowInstant().epochMilliseconds,
  }: {
    organizationId: string;
    senderUserId: string;
    count: number;
    now?: number;
  }): Promise<void> {
    const max = await this.deps.plans.requestBound({
      key: "invitesCreatedPerHour",
      organizationId,
    });
    const decision = await this.deps.rateLimit.limit({
      key: `invites-created:${senderUserId}`,
      windowSeconds: INVITE_CREATION_WINDOW_SECONDS,
      max,
      count,
    });
    if (decision.allowed) {
      return;
    }

    throw new InvitesRateLimitedError(Math.max(1, Math.ceil((decision.resetAt - now) / 1000)));
  }
}
