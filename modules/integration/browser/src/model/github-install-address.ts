/**
 * "Connect GitHub" redirect URL. Return address lands back on this settings
 * page fragment; install entry point and mode come from the server.
 */

/** Where a redirect-mode install returns to. The page's own address. */
export const GITHUB_INSTALL_RETURN = "/settings/integrations#github";

/** The query parameter GitHub's failed round-trip lands back carrying. */
export const GITHUB_ERROR_QUERY_KEY = "githubError";

/**
 * The full install address, or null when the instance cannot start one. The
 * same endpoint serves the in-chat popup flow; this is the redirect-mode
 * variant, landing a full-page round-trip back on this page.
 */
export function githubInstallAddress(installUrl: string | null | undefined): string | null {
  if (!installUrl) return null;
  return `${installUrl}&mode=redirect&return=${encodeURIComponent(GITHUB_INSTALL_RETURN)}`;
}
