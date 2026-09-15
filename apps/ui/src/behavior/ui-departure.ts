/**
 * Leaving this application, which the router cannot do — the GitHub
 * ceremonies leave via full page load. `noopener,noreferrer` matters:
 * without it the new tab holds a live `window.opener` back into this one.
 */

/**
 * Whether a full-page navigation was asked for and the next document hasn't arrived yet. The
 * browser gives no signal for this, so an in-flight request the unload aborted looks identical
 * to a real failure — telling someone their sign-up broke moments before the next page arrives.
 */
let navigatingAway = false;

export function isUiNavigatingAway(): boolean {
  return navigatingAway;
}

/** Replaces this document with another address, in this tab. */
export function uiLeaveTo(url: string): void {
  navigatingAway = true;
  window.location.href = url;
}

/** Opens an address this application does not serve in a new tab. */
export function uiOpenExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
