import { nowInstant } from "@langwatch/time";

/**
 * The loop breaker for the self-hosted sole-connection redirect: each tab remembers its last
 * automatic dial and shows the button inside the window, so a round trip that comes back with
 * no session cannot bounce forever. Storage that throws counts as "not dialed yet".
 */
const STORAGE_KEY = "langwatch.signin.soleConnectionDialedAt";

export const SOLE_CONNECTION_REDIAL_WINDOW_MS = 2 * 60 * 1000;

/** Whether this tab may dial the sole connection automatically right now. */
export function soleConnectionAutoDialAllowed(now = nowInstant().epochMilliseconds): boolean {
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
export function rememberSoleConnectionAutoDial(now = nowInstant().epochMilliseconds): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, String(now));
  } catch {
    // Without storage the guard is off; the error page still stops a stable failure.
  }
}
