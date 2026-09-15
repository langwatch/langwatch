/** Recognised message for already-accepted invitations; must sync with server. */
export const INVITE_ALREADY_ACCEPTED_MESSAGE = "Invite was already accepted" as const;

/**
 * The same outcome, as the converted transport puts it on the wire. A handled
 * error travels as its CODE rather than its sentence, so both spellings are
 * recognised: the sentence for a deployment still on the old door, the code for
 * one on the annotated runtime.
 */
export const INVITE_ALREADY_ACCEPTED_CODE = "invite_already_accepted" as const;

/** Whether a refusal means the invitation had already been spent. */
export function isInviteAlreadyAccepted(message: string | undefined | null): boolean {
  return message === INVITE_ALREADY_ACCEPTED_MESSAGE || message === INVITE_ALREADY_ACCEPTED_CODE;
}
