/**
 * The address a holder opens. The path segment is the link's secret TOKEN, not
 * its row id — possession of the token is the whole authorization (ADR-057).
 */
export function shareUrlForToken(token: string): string {
  if (typeof window === "undefined") {
    return `/share/${token}`;
  }

  return `${window.location.origin}/share/${token}`;
}
