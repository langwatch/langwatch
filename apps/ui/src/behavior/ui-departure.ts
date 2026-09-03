/**
 * Leaving this application, which the router cannot do — the GitHub
 * ceremonies leave via full page load. `noopener,noreferrer` matters:
 * without it the new tab holds a live `window.opener` back into this one.
 */

/** Replaces this document with another address, in this tab. */
export function uiLeaveTo(url: string): void {
  window.location.href = url;
}

/** Opens an address this application does not serve in a new tab. */
export function uiOpenExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
