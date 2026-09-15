/**
 * Leaving this application, which the router cannot do — the GitHub
 * ceremonies leave via full page load. `noopener,noreferrer` matters:
 * without it the new tab holds a live `window.opener` back into this one.
 */

/**
 * Whether a full-page navigation has been asked for and the next document has
 * not arrived yet.
 *
 * The browser hands out no signal for this. Between the assignment and the new
 * document committing, the page carries on rendering and its in-flight requests
 * carry on failing — and a fetch the unload aborted is indistinguishable from a
 * server that could not be reached. A screen that draws its "we cannot reach
 * anything" card off that tells somebody their sign-up broke, in the moment
 * before the page they were being taken to arrives.
 *
 * One-way on purpose: the next document starts with a fresh module, so there is
 * nothing to reset. A navigation the browser declines to make is not a state
 * this module can observe, and a screen left waiting is the better wrong answer
 * of the two.
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
