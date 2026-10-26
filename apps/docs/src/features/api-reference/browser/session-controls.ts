import { Temporal } from "@langwatch/time";

import type { DocsSession } from "../model/docs-session.ts";
import {
  clear,
  connect,
  currentSession,
  disconnect,
  onSessionChange,
  type ConnectResult,
} from "./docs-session.ts";

const CONNECT_NOTES: Record<Exclude<ConnectResult, "granted">, string> = {
  denied: "You did not allow access. Paste an API key below instead.",
  blocked:
    "Your browser blocked the LangWatch window. Allow pop-ups for this site, or paste an API key below.",
  closed: "The LangWatch window closed before access was granted. Try again, or paste an API key.",
  timeout: "LangWatch did not answer within two minutes. Try again, or paste an API key.",
};
const ENDED = "Your access ended. Connect again to keep sending.";

function part(name: string) {
  return document.querySelector<HTMLElement>(`[data-docs-session-${name}]`);
}

function until({ expiresAt }: { expiresAt: number }) {
  return Temporal.Instant.fromEpochMilliseconds(expiresAt).toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Shows the connection, or the note after it, in the playground's prerendered controls. */
export function showSession({ note }: { note?: string } = {}) {
  const session = currentSession();
  const status = part("status");
  const connectButton = part("connect");
  const disconnectButton = part("disconnect");
  const manual = document.querySelector<HTMLElement>("[data-docs-manual-key]");
  if (connectButton) connectButton.hidden = Boolean(session);
  if (disconnectButton) disconnectButton.hidden = !session;
  if (manual) manual.hidden = Boolean(session);
  if (!status) return;
  status.textContent = session
    ? `Sending as you in ${session.project.name}, until ${until(session)}.${note ? ` ${note}` : ""}`
    : (note ?? "Or paste an API key below.");
}

/** What a response means for the connection: a 401 ends it, a 403 explains the refusal. */
export function afterResponse({ status, session }: { status: number; session: DocsSession }) {
  if (status === 401) {
    clear();
    showSession({ note: ENDED });
  } else if (status === 403) {
    showSession({
      note: `Your access in ${session.project.name} does not allow this request.`,
    });
  }
}

async function onConnect() {
  const button = part("connect");
  if (button instanceof HTMLButtonElement) button.disabled = true;
  const status = part("status");
  if (status) status.textContent = "Waiting for LangWatch…";
  const result = await connect();
  if (button instanceof HTMLButtonElement) button.disabled = false;
  showSession({ note: result === "granted" ? undefined : CONNECT_NOTES[result] });
}

async function onDisconnect() {
  const result = await disconnect();
  showSession({
    note:
      result === "revoked"
        ? "Disconnected."
        : "Disconnected in this tab. LangWatch could not be reached, so the access ends on its own within five minutes.",
  });
}

let previous: DocsSession | null = null;
onSessionChange((session) => {
  /* An expiry the timer noticed, not a disconnect: say so where the reader looks. */
  showSession({ note: !session && previous ? ENDED : undefined });
  previous = session;
});

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("[data-docs-session-connect]")) void onConnect();
  if (target?.closest("[data-docs-session-disconnect]")) void onDisconnect();
});
