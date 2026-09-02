/**
 * Leaving this application, which the router cannot do.
 *
 * `UiNavigationPort` moves within the route table; these two do not. The GitHub
 * install ceremony replaces this document with github.com's own flow and comes
 * back through a full page load, and the uninstall half opens GitHub in a
 * second tab. Neither is a route, so neither is `navigate`.
 *
 * It lives in global behaviour rather than in a feature for the usual reason: a
 * `window` global is one of the things ADR-004 seals off from a screen, and this
 * module is the seam that keeps it out of them. A `hardTo` is also what busts
 * caches primed with pre-navigation state, which is why the platform pages
 * reached for `window.location` rather than the router in the first place.
 *
 * `noopener,noreferrer` on the new tab is not decoration: without it the opened
 * document holds a live `window.opener` handle back into this one.
 */

/** Replaces this document with another address, in this tab. */
export function uiLeaveTo(url: string): void {
  window.location.href = url;
}

/** Opens an address this application does not serve in a new tab. */
export function uiOpenExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
