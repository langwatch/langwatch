/**
 * Full-page navigation via module seam for testability; window.location non-configurable
 */

/** True in the browser; false during SSR and in node-environment tests. */
function hasWindow(): boolean {
  return typeof window !== "undefined";
}

/**
 * Leave the app for `url`, keeping this page in session history — the back
 * button returns to where the user was, which is what you want for a link
 * out or a redirect the user may want to undo.
 */
export function hardNavigate(url: string): void {
  if (!hasWindow()) return;
  window.location.href = url;
}

/**
 * Go to `url` and drop the current page from session history — for a page
 * the user must not go back to: a consumed one-time link, or a sign-in
 * screen once the session exists.
 */
export function replaceLocation(url: string): void {
  if (!hasWindow()) return;
  window.location.replace(url);
}

/**
 * Rebuild the current page from the server — a blunt instrument: it discards
 * every in-memory cache and unmounts the app, taking any toast or in-flight
 * interaction with it. Prefer invalidating the queries that actually moved.
 */
export function reloadPage(): void {
  if (!hasWindow()) return;
  window.location.reload();
}
