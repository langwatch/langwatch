/**
 * The parent -> child handoff of a Twilio media socket.
 *
 * The listener runs in the parent worker process and owns the public port; the
 * SDK adapter that speaks the Twilio Media Streams protocol runs in the scenario
 * child. Node's `ChildProcess.send(message, sendHandle)` is the one mechanism
 * that moves a live `net.Socket` across that boundary, so the parent takes the
 * raw socket off the HTTP upgrade (it does NOT complete the WebSocket handshake)
 * and sends it, with the bytes already read off the wire, to the owning child.
 * The child completes the handshake against its own `ws` server.
 *
 * This module is the whole seam between slice 3 (listener + handoff) and slice 2
 * (the Twilio adapter): slice 3 sends the socket, slice 2 installs a receiver
 * and drives the socket. Keeping the message shape here, shared by both sides,
 * is what lets slice 2 plug in without touching the listener.
 *
 * The child must be spawned with an `"ipc"` channel in its stdio for `send` to
 * carry a handle; that spawn change belongs to slice 2, which is the code that
 * registers a nonce against a child in the first place.
 */

import type { ChildProcess } from "node:child_process";
import type { Socket } from "node:net";

/** Discriminates the handoff message from every other child IPC message. */
export const VOICE_MEDIA_SOCKET_MESSAGE = "voice:twilio-media-socket" as const;

/**
 * The handoff message. Carries everything the child needs to finish the
 * WebSocket handshake itself: the request line, the headers, and the bytes the
 * parent already consumed off the socket during the upgrade (base64, since IPC
 * JSON cannot carry a Buffer intact).
 */
export interface VoiceMediaSocketMessage {
  type: typeof VOICE_MEDIA_SOCKET_MESSAGE;
  /** The nonce the upgrade authenticated with, for the child's own logging. */
  nonce: string;
  /** The upgrade request path, e.g. `/twilio/<nonce>`. */
  url: string;
  /** The upgrade request method (always GET for a WebSocket upgrade). */
  method: string;
  /** The upgrade request headers, needed to compute the Sec-WebSocket-Accept. */
  headers: Record<string, string | string[] | undefined>;
  /** Base64 of the bytes read off the socket during the upgrade (the head). */
  headBase64: string;
}

/** Narrows an arbitrary IPC message to the voice handoff message. */
export function isVoiceMediaSocketMessage(
  message: unknown,
): message is VoiceMediaSocketMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === VOICE_MEDIA_SOCKET_MESSAGE
  );
}

/**
 * Parent side: hand the accepted upgrade socket to the owning child. Resolves
 * once Node has serialised the handle to the child, rejects if the send fails
 * (a dead child, or a process with no IPC channel).
 */
export function handOffVoiceSocket(params: {
  child: ChildProcess;
  socket: Socket;
  nonce: string;
  url: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  head: Buffer;
}): Promise<void> {
  const message: VoiceMediaSocketMessage = {
    type: VOICE_MEDIA_SOCKET_MESSAGE,
    nonce: params.nonce,
    url: params.url,
    method: params.method,
    headers: params.headers,
    headBase64: params.head.toString("base64"),
  };
  return new Promise<void>((resolve, reject) => {
    if (typeof params.child.send !== "function") {
      reject(new Error("child has no IPC channel; cannot hand off the socket"));
      return;
    }
    params.child.send(message, params.socket, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/** What a receiver hands its caller for one arrived socket. */
export interface ReceivedVoiceSocket {
  message: VoiceMediaSocketMessage;
  socket: Socket;
  /** The upgrade head bytes, decoded from {@link VoiceMediaSocketMessage.headBase64}. */
  head: Buffer;
}

/**
 * Child side: the tiny shim slice 2 plugs its Twilio adapter into. Listens for
 * the parent's handoff message on the process IPC channel and invokes the
 * handler with the socket and the decoded head. Returns an unsubscribe.
 *
 * Behind an interface on purpose: slice 2 depends on this signature, not on the
 * listener, so the two slices compose without either importing the other's
 * internals.
 */
export interface VoiceSocketReceiver {
  onVoiceSocket(handler: (received: ReceivedVoiceSocket) => void): () => void;
}

/** IPC-bearing subset of `process` the receiver needs; eases testing. */
export interface VoiceSocketProcess {
  on(
    event: "message",
    listener: (message: unknown, handle: unknown) => void,
  ): unknown;
  off(
    event: "message",
    listener: (message: unknown, handle: unknown) => void,
  ): unknown;
}

/**
 * Build a receiver over a process-like IPC surface (defaults to the real
 * `process`). The handler fires only for the voice handoff message and only
 * when a socket handle actually arrived.
 */
export function createVoiceSocketReceiver(
  proc: VoiceSocketProcess = process,
): VoiceSocketReceiver {
  return {
    onVoiceSocket(handler) {
      const listener = (message: unknown, handle: unknown): void => {
        if (!isVoiceMediaSocketMessage(message)) return;
        if (handle == null) return;
        handler({
          message,
          socket: handle as Socket,
          head: Buffer.from(message.headBase64, "base64"),
        });
      };
      proc.on("message", listener);
      return () => {
        proc.off("message", listener);
      };
    },
  };
}
