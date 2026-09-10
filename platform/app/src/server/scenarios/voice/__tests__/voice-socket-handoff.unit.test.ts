/**
 * @see specs/features/agents/voice-phone.feature
 */

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import {
  createVoiceSocketReceiver,
  handOffVoiceSocket,
  isVoiceMediaSocketMessage,
  VOICE_MEDIA_SOCKET_MESSAGE,
  type VoiceMediaSocketMessage,
} from "../voice-socket-handoff";

function message(): VoiceMediaSocketMessage {
  return {
    type: VOICE_MEDIA_SOCKET_MESSAGE,
    nonce: "abc",
    url: "/twilio/abc",
    method: "GET",
    headers: { upgrade: "websocket" },
    headBase64: Buffer.from("hello").toString("base64"),
  };
}

describe("isVoiceMediaSocketMessage", () => {
  it("matches only the voice handoff message", () => {
    expect(isVoiceMediaSocketMessage(message())).toBe(true);
    expect(isVoiceMediaSocketMessage({ type: "something-else" })).toBe(false);
    expect(isVoiceMediaSocketMessage(null)).toBe(false);
    expect(isVoiceMediaSocketMessage("string")).toBe(false);
  });
});

describe("createVoiceSocketReceiver", () => {
  describe("when the parent hands over a socket", () => {
    it("invokes the handler with the socket and the decoded head", () => {
      const proc = new EventEmitter();
      const receiver = createVoiceSocketReceiver(proc);
      const handler = vi.fn();
      receiver.onVoiceSocket(handler);

      const socket = { id: "sock" } as unknown as Socket;
      proc.emit("message", message(), socket);

      expect(handler).toHaveBeenCalledTimes(1);
      const received = handler.mock.calls[0]?.[0];
      expect(received.socket).toBe(socket);
      expect(received.head.toString()).toBe("hello");
      expect(received.message.nonce).toBe("abc");
    });
  });

  describe("when the message is not a handoff or carries no socket", () => {
    it("ignores it", () => {
      const proc = new EventEmitter();
      const receiver = createVoiceSocketReceiver(proc);
      const handler = vi.fn();
      receiver.onVoiceSocket(handler);

      proc.emit("message", { type: "other" }, { id: "sock" });
      proc.emit("message", message(), null); // handoff shape, no handle
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("when unsubscribed", () => {
    it("stops receiving", () => {
      const proc = new EventEmitter();
      const receiver = createVoiceSocketReceiver(proc);
      const handler = vi.fn();
      const off = receiver.onVoiceSocket(handler);

      off();
      proc.emit("message", message(), { id: "sock" });
      expect(handler).not.toHaveBeenCalled();
    });
  });
});

describe("handOffVoiceSocket", () => {
  it("rejects when the child has no IPC channel", async () => {
    const child = {} as unknown as ChildProcess; // no send
    await expect(
      handOffVoiceSocket({
        child,
        socket: {} as unknown as Socket,
        nonce: "abc",
        url: "/twilio/abc",
        method: "GET",
        headers: {},
        head: Buffer.alloc(0),
      }),
    ).rejects.toThrow(/IPC channel/);
  });

  it("sends the message and the socket handle, then resolves", async () => {
    const send = vi.fn(
      (_msg: unknown, _handle: unknown, cb: (error: Error | null) => void) => {
        cb(null);
        return true;
      },
    );
    const child = { send } as unknown as ChildProcess;
    const socket = { id: "sock" } as unknown as Socket;

    await handOffVoiceSocket({
      child,
      socket,
      nonce: "abc",
      url: "/twilio/abc",
      method: "GET",
      headers: { upgrade: "websocket" },
      head: Buffer.from("hi"),
    });

    expect(send).toHaveBeenCalledTimes(1);
    const [sentMessage, sentHandle] = send.mock.calls[0] ?? [];
    expect(isVoiceMediaSocketMessage(sentMessage)).toBe(true);
    expect((sentMessage as VoiceMediaSocketMessage).headBase64).toBe(
      Buffer.from("hi").toString("base64"),
    );
    expect(sentHandle).toBe(socket);
  });
});
