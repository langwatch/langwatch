/**
 * The link an invite carries: rendered by the email template and returned in the invite listing,
 * one builder so the two never drift. Lives outside the mailer module since tests routinely mock
 * it, and takes the deployment's public host as an argument rather than reading env directly.
 */
export function buildInviteAcceptUrl(baseHost: string, inviteCode: string): string {
  return `${baseHost}/invite/accept?inviteCode=${encodeURIComponent(inviteCode)}`;
}

/**
 * Where an admin goes to act on invitations — the "somebody is waiting" mail carries this
 * rather than a link that sends anything, since resending stays an authenticated table click.
 */
export function buildMembersSettingsUrl(baseHost: string): string {
  return `${baseHost}/settings/members`;
}
