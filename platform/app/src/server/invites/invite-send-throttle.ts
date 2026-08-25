import { rateLimit } from "../rateLimit";
import { InviteThrottledError } from "./errors";

/**
 * How often one invitation may put mail in somebody's inbox (D11).
 *
 * The limit is per INVITATION rather than per admin or per organization,
 * because the thing being protected is the recipient. An admin with three
 * invitations out may send all three; nobody gets the same invitation over
 * and over. Three within the window leaves room for the honest retries — a
 * typo'd domain fixed by re-inviting, a "did you get it?" — while a click
 * held down, a stuck retry loop, or somebody using an invitation as a way
 * to mail a stranger runs out immediately.
 *
 * Both directions land here: the admin resending from the members table, and
 * the invitee asking for a fresh one from an expired link. They share the
 * counter on purpose — two routes to the same inbox is exactly the gap a
 * per-route limit would leave open.
 */
export const INVITE_SEND_WINDOW_SECONDS = 60 * 60;
export const INVITE_SENDS_PER_WINDOW = 3;

/**
 * Refuses when this invitation has already been sent its fill for now.
 *
 * Called BEFORE the send, so a refused attempt changes nothing: resend
 * rotates the code, and rotation is the old link's revocation, so a
 * throttled click that still rotated would break the link already in the
 * invitee's inbox to no purpose.
 */
export async function assertInviteSendAllowed({
  inviteId,
  now = Date.now(),
}: {
  inviteId: string;
  now?: number;
}): Promise<void> {
  const decision = await rateLimit({
    key: `invite.send:${inviteId}`,
    windowSeconds: INVITE_SEND_WINDOW_SECONDS,
    max: INVITE_SENDS_PER_WINDOW,
  });
  if (decision.allowed) return;

  throw new InviteThrottledError(
    Math.max(1, Math.ceil((decision.resetAt - now) / 1000)),
  );
}
