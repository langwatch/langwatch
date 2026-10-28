import { docsAppOrigin } from "../../../config.ts";
import {
  FRAME_MESSAGE,
  FRAME_VERSION,
  frameUrl,
  readFrameMessage,
  resolveAppOrigin,
  type FrameFailure,
  type FrameMessage,
} from "../model/docs-session.ts";

/*
 * The bridge to the app's session frame (ADR-185, amendment of 2026-10-28). The frame holds the
 * reader's key and sends the requests; this page only embeds it, hears whether it is connected
 * and asks it to send. Nothing here ever sees a key.
 */

export type FrameAnswer =
  | Extract<FrameMessage, { kind: "response" }>
  | { kind: "failed"; reason: FrameFailure };
type Listener = (connected: { project: string } | null) => void;

let frame: HTMLIFrameElement | null = null;
let connected: { project: string } | null = null;
let nextId = 0;
const waiting = new Map<string, (answer: FrameAnswer) => void>();
const listeners = new Set<Listener>();

export function appOrigin(): string {
  return resolveAppOrigin({ configured: docsAppOrigin, pageOrigin: location.origin });
}

/** The project the frame is connected in, or null while it is not. */
export function frameConnection() {
  return connected;
}

export function onConnectionChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setConnected(next: { project: string } | null) {
  if (next?.project === connected?.project) return;
  connected = next;
  for (const listener of listeners) listener(connected);
}

function onMessage(event: MessageEvent) {
  if (!frame || event.origin !== appOrigin() || event.source !== frame.contentWindow) return;
  const message = readFrameMessage({ data: event.data });
  if (!message) return;
  if (message.kind === "state")
    setConnected(
      message.connected && message.project !== null ? { project: message.project } : null,
    );
  else if (message.kind === "height") frame.style.height = `${Math.ceil(message.height)}px`;
  else {
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
  }
}

/** Embeds the app's session frame in `container`, once; a later call keeps the one there. */
export function mountFrame({ container }: { container: HTMLElement }) {
  if (frame?.isConnected) return;
  frame = document.createElement("iframe");
  frame.src = frameUrl({ appOrigin: appOrigin(), docsOrigin: location.origin });
  frame.title = "Use my LangWatch account";
  frame.className = "docs-session-frame";
  frame.referrerPolicy = "no-referrer";
  container.append(frame);
  window.addEventListener("message", onMessage);
}

/** Removes the frame, which ends its connection and revokes the key on the way out. */
export function unmountFrame() {
  window.removeEventListener("message", onMessage);
  frame?.remove();
  frame = null;
  setConnected(null);
  for (const resolve of waiting.values()) resolve({ kind: "failed", reason: "cancelled" });
  waiting.clear();
}

function toFrame(message: Record<string, unknown>) {
  frame?.contentWindow?.postMessage(
    { type: FRAME_MESSAGE, version: FRAME_VERSION, ...message },
    appOrigin(),
  );
}

/** Asks the frame to send `request` as the reader; an abort asks it to cancel. */
export function sendThroughFrame({
  request,
  signal,
}: {
  request: { method: string; path: string; headers: Record<string, string>; body: string | null };
  signal: AbortSignal;
}): Promise<FrameAnswer> {
  if (!frame) return Promise.resolve({ kind: "failed", reason: "not-connected" });
  nextId += 1;
  const id = `request-${nextId}`;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    signal.addEventListener(
      "abort",
      () => {
        toFrame({ kind: "cancel", id });
        waiting.delete(id);
        resolve({ kind: "failed", reason: signal.reason === "timeout" ? "timeout" : "cancelled" });
      },
      { once: true },
    );
    toFrame({ kind: "send", id, ...request });
  });
}

document.addEventListener("docs:leaving", unmountFrame);
