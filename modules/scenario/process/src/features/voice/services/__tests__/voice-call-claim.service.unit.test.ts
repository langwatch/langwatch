/**
 * Node detaches the http server's socket error listener before emitting "upgrade", so accept()
 * must register its own before the async claim starts. Without it, a client reset in that
 * window is an unhandled "error" event, which Node rethrows synchronously from socket.emit().
 */
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { Socket } from "node:net";

import type { VoiceMediaUpgrade } from "@langwatch/scenario-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: vi.fn(() => mockLogger),
}));

import { VoiceCallClaimService } from "../voice-call-claim.service.ts";

function upgradeOn(socket: Socket): VoiceMediaUpgrade {
  return {
    nonce: "nonce-a",
    url: "/twilio/run-a/nonce-a",
    method: "GET",
    headers: {},
    head: new Uint8Array(0),
    socket,
  };
}

/** A real ChildProcess shape whose send() hands off clean, with no real IPC underneath. */
class FakeChildProcess extends EventEmitter implements ChildProcess {
  stdin = null;
  stdout = null;
  stderr = null;
  readonly channel = null;
  readonly stdio = [null, null, null, null, null] as ChildProcess["stdio"];
  readonly killed = false;
  readonly pid = 4242;
  readonly connected = true;
  readonly exitCode = null;
  readonly signalCode = null;
  readonly spawnargs: string[] = [];
  readonly spawnfile = "";

  send(
    _message: unknown,
    handleOrCallback?: unknown,
    maybeCallback?: (error: Error | null) => void,
  ): boolean {
    const callback = (typeof handleOrCallback === "function" ? handleOrCallback : maybeCallback) as
      | ((error: Error | null) => void)
      | undefined;
    queueMicrotask(() => callback?.(null));
    return true;
  }

  kill(): boolean {
    return true;
  }

  disconnect(): void {}
  ref(): void {}
  unref(): void {}
  [Symbol.dispose](): void {}
}

describe("VoiceCallClaimService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("given an upgrade with no pending call", () => {
    it("registers a socket error listener before the claim settles, so a reset does not throw", () => {
      const service = VoiceCallClaimService.create({
        pending: { take: async () => ({ taken: false }) },
        spawnChild: () => {
          throw new Error("not expected: no call was pending");
        },
      });
      const socket = new Socket();

      service.accept(upgradeOn(socket));

      expect(() => socket.emit("error", new Error("synthetic client reset"))).not.toThrow();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ nonce: "nonce-a" }),
        "voice media socket errored",
      );
    });

    it("throws from emit when nothing listens for the socket's error, as a control for the above", () => {
      const socket = new Socket();

      expect(() => socket.emit("error", new Error("unlistened"))).toThrow("unlistened");
    });

    it("destroys the refused socket itself if the client never closes its side", async () => {
      vi.useFakeTimers();
      const service = VoiceCallClaimService.create({
        pending: { take: async () => ({ taken: false }) },
        spawnChild: () => {
          throw new Error("not expected: no call was pending");
        },
      });
      const socket = new Socket();
      const end = vi.spyOn(socket, "end").mockReturnValue(socket);
      const destroy = vi.spyOn(socket, "destroy").mockReturnValue(socket);

      service.accept(upgradeOn(socket));
      await vi.advanceTimersByTimeAsync(0); // flush pending.take()'s microtask
      expect(end).toHaveBeenCalled();
      expect(destroy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5000);

      expect(destroy).toHaveBeenCalled();
    });

    it("does not destroy the refused socket once the client closes its own side", async () => {
      vi.useFakeTimers();
      const service = VoiceCallClaimService.create({
        pending: { take: async () => ({ taken: false }) },
        spawnChild: () => {
          throw new Error("not expected: no call was pending");
        },
      });
      const socket = new Socket();
      vi.spyOn(socket, "end").mockReturnValue(socket);
      const destroy = vi.spyOn(socket, "destroy").mockReturnValue(socket);

      service.accept(upgradeOn(socket));
      await vi.advanceTimersByTimeAsync(0); // flush pending.take()'s microtask
      socket.emit("close");
      await vi.advanceTimersByTimeAsync(5000);

      expect(destroy).not.toHaveBeenCalled();
    });
  });

  describe("given a pending call that spawns a child", () => {
    let child: FakeChildProcess;
    let socket: Socket;
    let destroy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      child = new FakeChildProcess();
      socket = new Socket();
      destroy = vi.spyOn(socket, "destroy").mockReturnValue(socket);
    });

    function acceptAndSettle(): Promise<void> {
      const service = VoiceCallClaimService.create({
        pending: { take: async () => ({ taken: true, call: { nonce: "nonce-a" } }) },
        spawnChild: () => child,
      });
      service.accept(upgradeOn(socket));
      return new Promise((resolve) => setImmediate(resolve));
    }

    it("logs a warning when the spawned child exits, after a successful handoff", async () => {
      await acceptAndSettle();

      child.emit("exit", 1, null);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ nonce: "nonce-a", code: 1, signal: null }),
        "voice child exited",
      );
    });

    it("destroys the parent's socket once the handoff succeeds", async () => {
      await acceptAndSettle();

      expect(destroy).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ nonce: "nonce-a" }),
        "voice media socket handed to spawned child",
      );
    });
  });
});
