import { env } from "~/env.mjs";

/**
 * The link an invite carries: the email template renders it, and the invite
 * listing returns it so a provisioning tool with no email provider
 * configured can hand the invite to the person some other way. One builder
 * so the two can never drift.
 *
 * Lives outside the mailer module on purpose: tests routinely mock the
 * mailer to keep real email out of a run, and a pure URL builder stranded
 * inside a mocked module disappears with it.
 */
export function buildInviteAcceptUrl(inviteCode: string): string {
  return `${env.BASE_HOST}/invite/accept?inviteCode=${encodeURIComponent(inviteCode)}`;
}

/**
 * Where an admin goes to act on invitations. The "somebody is waiting" mail
 * carries this rather than a link that sends anything: resending is an
 * authenticated click on the members table, and mail is not a place to put
 * a second way to mint a live invite code.
 *
 * The page reads its organization from the signed-in session, so there is no
 * organization in the URL — an admin of two organizations lands in whichever
 * one they are currently in, and the mail names the organization in words.
 */
export function buildMembersSettingsUrl(): string {
  return `${env.BASE_HOST}/settings/members`;
}
