/**
 * A full page load, so nothing in memory outlives a session change (as auth's hard-redirect.ts).
 * window.location is non-configurable, so a test mocks this module instead.
 */
export function hardRedirect(url: string): void {
  window.location.assign(url);
}
