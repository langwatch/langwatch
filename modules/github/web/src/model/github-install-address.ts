/**
 * Where "Connect GitHub" sends somebody, built from what the server handed back.
 *
 * THE INSTALL ENTRY POINT IS THE SERVER'S. `getConnectionStatus` answers with
 * `installUrl` already carrying the App slug and the state the flow needs, so
 * neither is spelled here; the screen only says which MODE it wants and where
 * the round-trip should land. Splitting that off the click handler is what lets
 * a suite assert the address without a navigation jsdom never performs.
 *
 * The return address is the page's own, fragment included, so the round-trip
 * comes back to the GitHub card rather than to the top of Settings.
 */

/** Where a redirect-mode install returns to. The page's own address. */
export const GITHUB_INSTALL_RETURN = "/settings/integrations#github";

/** The query parameter GitHub's failed round-trip lands back carrying. */
export const GITHUB_ERROR_QUERY_KEY = "githubError";

/**
 * The full install address, or null when the instance cannot start one.
 *
 * The same endpoint serves the in-chat popup flow; this is the redirect-mode
 * variant, so a full-page round-trip lands back on this page.
 */
export function githubInstallAddress(installUrl: string | null | undefined): string | null {
  if (!installUrl) return null;
  return `${installUrl}&mode=redirect&return=${encodeURIComponent(GITHUB_INSTALL_RETURN)}`;
}
