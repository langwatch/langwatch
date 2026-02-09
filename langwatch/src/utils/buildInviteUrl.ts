/**
 * Builds the invite acceptance URL from an origin and invite code.
 *
 * Each call site provides its own origin (e.g. `window.location.origin`
 * on the client, `env.BASE_HOST` on the server).
 */
export function buildInviteUrl({
  origin,
  inviteCode,
}: {
  origin: string;
  inviteCode: string;
}): string {
  const normalizedOrigin = origin.replace(/\/+$/, "");
  return `${normalizedOrigin}/invite/accept?inviteCode=${inviteCode}`;
}
