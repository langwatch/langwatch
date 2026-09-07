/**
 * Full-page navigation, behind a seam a test can substitute.
 *
 * These are the cases the SPA router deliberately cannot serve: leaving the
 * app for an auth handshake, or forcing a fresh document so every provider,
 * session and cache is rebuilt from scratch. They are real navigations, and
 * they belong in exactly one place.
 *
 * The reason it is a module and not a bare `window.location.href = ...` at the
 * call site is testability, and the constraint is harder than it looks.
 * `window.location` is a NON-CONFIGURABLE ACCESSOR, and its methods are
 * non-configurable and non-writable — measured directly in a jsdom VM realm:
 *
 *   Object.defineProperty(window, "location", ...)  -> Cannot redefine property
 *   vi.spyOn(window, "location", "get")             -> Cannot redefine property
 *   vi.spyOn(window.location, "reload")             -> Cannot redefine property
 *   vi.stubGlobal("location", ...)                  -> Cannot redefine property
 *
 * Every technique for observing a navigation by patching the global fails, and
 * assigning `href` for real just makes jsdom log "Not implemented: navigation"
 * without recording anything. So a test cannot see a navigation that a
 * component performs directly, and the tests that appeared to were relying on
 * a pool where jsdom happened to leave `location` replaceable.
 *
 * A module import is substitutable by `vi.mock` in any environment, which is
 * why this exists. Call these instead of touching `window.location`, and a
 * test asserts the navigation by asserting the call.
 */

/** True in the browser; false during SSR and in node-environment tests. */
function hasWindow(): boolean {
  return typeof window !== "undefined";
}

/**
 * Leave the app for `url`, keeping this page in session history.
 *
 * The back button returns to where the user was, which is what you want for a
 * link out and for a redirect the user may want to undo.
 */
export function hardNavigate(url: string): void {
  if (!hasWindow()) return;
  window.location.href = url;
}

/**
 * Go to `url` and drop the current page from session history.
 *
 * For a page the user must not be able to go back to — a consumed one-time
 * link, or a sign-in screen once the session exists.
 */
export function replaceLocation(url: string): void {
  if (!hasWindow()) return;
  window.location.replace(url);
}

/**
 * Rebuild the current page from the server.
 *
 * A blunt instrument: it discards every in-memory cache and unmounts the app,
 * which takes any toast or in-flight interaction with it. Prefer invalidating
 * the queries that actually moved.
 */
export function reloadPage(): void {
  if (!hasWindow()) return;
  window.location.reload();
}
