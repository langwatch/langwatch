/**
 * The loop breaker for the self-hosted sole-connection redirect.
 *
 * A self-hosted deployment with one live connection sends a signed-out visitor
 * straight to its identity provider. If that round trip comes back to the
 * sign-in page without a session (the provider refused, the callback failed,
 * a cookie was not kept), dialing again would bounce the browser between the
 * two forever. So each tab remembers when it last dialed automatically, and
 * inside the window below the page shows the button instead.
 *
 * Per tab (sessionStorage), so a fresh tab or browser still goes straight
 * through. Storage that throws counts as "not dialed yet": the redirect is the
 * product behavior, and the error page already stops at a stable failure.
 */
const STORAGE_KEY = "langwatch.signin.soleConnectionDialedAt";

export const SOLE_CONNECTION_REDIAL_WINDOW_MS = 2 * 60 * 1000;

/** Whether this tab may dial the sole connection automatically right now. */
export function soleConnectionAutoDialAllowed(now = Date.now()): boolean {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return true;
    const dialedAt = Number(raw);
    if (!Number.isFinite(dialedAt)) return true;
    return now - dialedAt >= SOLE_CONNECTION_REDIAL_WINDOW_MS;
  } catch {
    return true;
  }
}

/** Records that this tab just dialed the sole connection automatically. */
export function rememberSoleConnectionAutoDial(now = Date.now()): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, String(now));
  } catch {
    // Without storage the guard is off; the error page still stops a stable
    // failure from looping.
  }
}
