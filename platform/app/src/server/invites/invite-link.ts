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
  return `${env.BASE_HOST}/invite/accept?inviteCode=${inviteCode}`;
}
