/**
 * How often one invitation may put mail in somebody's inbox (D11).
 */
import { InviteThrottledError } from "./invite-errors.service";
import type { OrganizationInviteRateLimitPort } from "../ports/invite.port";

export const INVITE_SEND_WINDOW_SECONDS = 60 * 60;
export const INVITE_SENDS_PER_WINDOW = 3;

/**
 * The window, spent against whichever counter the process composed.
 */
export class InviteSendThrottleService {
  private constructor(private readonly rateLimit: OrganizationInviteRateLimitPort) {}

  static create(rateLimit: OrganizationInviteRateLimitPort): InviteSendThrottleService {
    return new InviteSendThrottleService(rateLimit);
  }

  /**
   * Refuses when this invitation has already been sent its fill for now.
   */
  async assertInviteSendAllowed({
    inviteId,
    now = Date.now(),
  }: {
    inviteId: string;
    now?: number;
  }): Promise<void> {
    const decision = await this.rateLimit.limit({
      key: `invite.send:${inviteId}`,
      windowSeconds: INVITE_SEND_WINDOW_SECONDS,
      max: INVITE_SENDS_PER_WINDOW,
    });
    if (decision.allowed) {
      return;
    }

    throw new InviteThrottledError(Math.max(1, Math.ceil((decision.resetAt - now) / 1000)));
  }
}
