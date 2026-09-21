/**
 * Schemes an OAuth redirect_uri may never use, shared by the authorize route
 * that verifies the URI and the consent page that navigates to it, so the two
 * cannot drift apart.
 *
 * This is a deny-list rather than an `http:`/`https:` allow-list on purpose.
 * Native MCP clients complete the OAuth flow through a custom-scheme callback
 * they register with the operating system (an editor or desktop app answering
 * its own `something://` URI), and RFC 8252 §7.1 names exactly that as the
 * redirect for a native app. An allow-list would refuse every one of them and
 * leave those clients unable to connect at all.
 *
 * So the list names what a browser executes or resolves against our own
 * origin, which is the class that turns a redirect into script execution:
 * `javascript:`, `vbscript:` and `data:` run, and `blob:`/`filesystem:` URLs
 * are same-origin with the page that created them.
 */
export const DISALLOWED_REDIRECT_SCHEMES = [
  "javascript:",
  "vbscript:",
  "data:",
  "blob:",
  "filesystem:",
] as const;

/** Whether a redirect_uri is safe to navigate to. Unparseable means no. */
export function isAllowedRedirectScheme(candidate: string): boolean {
  try {
    return !(DISALLOWED_REDIRECT_SCHEMES as readonly string[]).includes(
      new URL(candidate).protocol,
    );
  } catch {
    return false;
  }
}
