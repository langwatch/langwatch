// Parent -> child handoff of Twilio media socket via Node's ChildProcess.send(message, sendHandle).
// Parent takes raw socket off HTTP upgrade; child completes WebSocket handshake on own ws server.

import type { ChildProcess } from "node:child_process";
import { Socket } from "node:net";

import {
  isVoiceMediaSocketMessage,
  VOICE_MEDIA_SOCKET_MESSAGE,
  type VoiceMediaSocketMessage,
} from "@langwatch/scenario-contract";

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

// Child: shim for Twilio adapter. Listens for parent's handoff on IPC and invokes handler.
// Behind interface so slices compose without importing each other's internals.
export interface VoiceSocketReceiver {
  onVoiceSocket(handler: (received: ReceivedVoiceSocket) => void): () => void;
}

/** IPC-bearing subset of `process` the receiver needs; eases testing. */
interface VoiceSocketProcess {
  on(event: "message", listener: (message: unknown, handle: unknown) => void): unknown;
  off(event: "message", listener: (message: unknown, handle: unknown) => void): unknown;
}

/**
 * Build a receiver over a process-like IPC surface (defaults to the real
 * `process`). The handler fires only for the voice handoff message and only
 * when a socket handle actually arrived.
 */
export function createVoiceSocketReceiver(proc: VoiceSocketProcess = process): VoiceSocketReceiver {
  return {
    onVoiceSocket(handler) {
      const listener = (message: unknown, handle: unknown): void => {
        if (!isVoiceMediaSocketMessage(message)) return;
        if (!(handle instanceof Socket)) return;
        handler({
          message,
          socket: handle,
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
