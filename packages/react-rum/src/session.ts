import { nowInstant } from "@langwatch/time";
/**
 * The RUM session: the window of activity a visit represents (ADR-058).
 * Kept in `sessionStorage` so it dies with the tab, and rotated after an
 * inactivity gap so a reopened tab starts a new visit rather than one long one.
 */

const SESSION_ID_KEY = "langwatch.rum.session.id";
const SESSION_LAST_SEEN_KEY = "langwatch.rum.session.lastSeen";

/** A gap longer than this ends the session; the next span starts a new one. */
export const SESSION_INACTIVITY_MS = 30 * 60 * 1000;

const newSessionId = (): string => {
  // Matches the OTel session.id shape (16 bytes, hex). `randomUUID` is not used
  // because its dashes are not part of that shape.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

/**
 * The current session id, rotating it when the visit has gone quiet for longer
 * than {@link SESSION_INACTIVITY_MS}.
 *
 * Returns undefined when there is nowhere to keep it — Safari's private mode
 * throws on `sessionStorage`, and telemetry must never be the reason a page
 * fails to load.
 */
export function currentSessionId(now = nowInstant().epochMilliseconds): string | undefined {
  let storage: Storage;
  try {
    storage = window.sessionStorage;
  } catch {
    return void 0;
  }

  try {
    const lastSeen = Number(storage.getItem(SESSION_LAST_SEEN_KEY) ?? 0);
    const existing = storage.getItem(SESSION_ID_KEY);
    const expired = !lastSeen || now - lastSeen > SESSION_INACTIVITY_MS;

    const sessionId = existing && !expired ? existing : newSessionId();
    storage.setItem(SESSION_ID_KEY, sessionId);
    storage.setItem(SESSION_LAST_SEEN_KEY, String(now));

    return sessionId;
  } catch {
    return void 0;
  }
}
