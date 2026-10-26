import { nowInstant } from "@langwatch/time";

import { docsAppOrigin } from "../../../config.ts";
import {
  CONNECT_TIMEOUT_MS,
  connectUrl,
  newConnectState,
  readConsentAnswer,
  resolveAppOrigin,
  REVOKE_PATH,
  type DocsSession,
} from "../model/docs-session.ts";

export type ConnectResult = "granted" | "denied" | "blocked" | "closed" | "timeout";
type Listener = (session: DocsSession | null) => void;

/* Memory only, for the life of this tab: never storage, a URL or a log (ADR-185). */
let session: DocsSession | null = null;
let expiryTimer = 0;
let waiting: (() => void) | null = null;
const listeners = new Set<Listener>();

export function appOrigin(): string {
  return resolveAppOrigin({ configured: docsAppOrigin, pageOrigin: location.origin });
}

/** The connected member's key while it lasts; null once it has expired. */
export function currentSession(): DocsSession | null {
  if (session && session.expiresAt <= nowInstant().epochMilliseconds) clear();
  return session;
}

export function onSessionChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function set(next: DocsSession | null) {
  window.clearTimeout(expiryTimer);
  session = next;
  if (next)
    expiryTimer = window.setTimeout(
      clear,
      Math.max(0, next.expiresAt - nowInstant().epochMilliseconds),
    );
  for (const listener of listeners) listener(session);
}

/** Forgets the key in this tab, as on expiry or a 401; asks the app for nothing. */
export function clear() {
  if (session) set(null);
}

/**
 * Opens the app's consent page and waits for its answer. Called from a click, so the popup
 * is not blocked. Only a message from the app's origin, from this popup, with this state,
 * counts; a closed popup or two silent minutes give up and leave the pasted key in use.
 */
export function connect(): Promise<ConnectResult> {
  waiting?.();
  const app = appOrigin();
  const state = newConnectState();
  const popup = window.open(
    connectUrl({ appOrigin: app, docsOrigin: location.origin, state }),
    "langwatch-docs-connect",
    "popup,width=520,height=720",
  );
  if (!popup) return Promise.resolve("blocked");
  return new Promise((resolve) => {
    const finish = (result: ConnectResult) => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(watch);
      window.clearTimeout(timeout);
      waiting = null;
      resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== app || event.source !== popup) return;
      const answer = readConsentAnswer({ data: event.data, state, appOrigin: app });
      if (!answer) return;
      if (answer.outcome === "granted") set(answer.session);
      finish(answer.outcome);
    };
    window.addEventListener("message", onMessage);
    const watch = window.setInterval(() => {
      if (popup.closed) finish("closed");
    }, 500);
    const timeout = window.setTimeout(() => {
      popup.close();
      finish("timeout");
    }, CONNECT_TIMEOUT_MS);
    waiting = () => finish("closed");
  });
}

function revokeRequest({ key, keepalive }: { key: DocsSession; keepalive: boolean }) {
  return fetch(new URL(REVOKE_PATH, key.appOrigin), {
    method: "DELETE",
    headers: { "X-Auth-Token": key.token },
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    keepalive,
  });
}

/** Clears the key at once, then asks the app to revoke it; "local" when the app did not. */
export async function disconnect(): Promise<"revoked" | "local"> {
  const key = session;
  clear();
  if (!key) return "revoked";
  try {
    const response = await revokeRequest({ key, keepalive: false });
    return response.ok ? "revoked" : "local";
  } catch {
    return "local";
  }
}

/* Closing or reloading the tab revokes the key on the way out; it expires anyway. */
addEventListener("pagehide", () => {
  const key = session;
  clear();
  if (key) revokeRequest({ key, keepalive: true }).catch(() => {});
});
