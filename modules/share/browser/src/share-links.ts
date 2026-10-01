export * from "./share-expiry.ts";
export * from "./share-link-status.ts";

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

/**
 * `navigator.clipboard` needs a secure context, so a self-hosted plain-http
 * domain has no clipboard at all. Report that rather than failing silently;
 * the caller owns how it tells the reader.
 */
export async function copyShareLink(url: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return false;
    }

    await navigator.clipboard.writeText(url);

    return true;
  } catch {
    return false;
  }
}
