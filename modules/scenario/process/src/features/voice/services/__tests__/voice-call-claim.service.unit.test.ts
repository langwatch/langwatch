/**
 * Node detaches the http server's socket error listener before emitting "upgrade", so accept()
 * must register its own before the async claim starts. Without it, a client reset in that
 * window is an unhandled "error" event, which Node rethrows synchronously from socket.emit().
 */
import { Socket } from "node:net";

import type { VoiceMediaUpgrade } from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";

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

describe("VoiceCallClaimService", () => {
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
  });
});
