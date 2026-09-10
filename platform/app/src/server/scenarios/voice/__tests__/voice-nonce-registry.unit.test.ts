/**
 * @see specs/features/agents/voice-phone.feature
 */

import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import { VoiceNonceRegistry } from "../voice-nonce-registry";

/** A stand-in child; the registry only stores and returns the reference. */
const fakeChild = { pid: 123 } as unknown as ChildProcess;

describe("VoiceNonceRegistry", () => {
  describe("given a registered nonce", () => {
    it("returns the owning child once, then never again", () => {
      const registry = new VoiceNonceRegistry({ now: () => 1000 });
      registry.register({ nonce: "abc", child: fakeChild });

      const first = registry.consume("abc");
      expect(first).toEqual({ ok: true, child: fakeChild });

      // Single use: the same nonce is unknown on a replay.
      expect(registry.consume("abc")).toEqual({ ok: false, reason: "unknown" });
    });
  });

  describe("when the nonce was never registered", () => {
    /** @scenario "The media listener refuses an unknown or expired nonce" */
    it("reports it unknown", () => {
      const registry = new VoiceNonceRegistry();
      expect(registry.consume("missing")).toEqual({
        ok: false,
        reason: "unknown",
      });
    });
  });

  describe("when the nonce has expired", () => {
    /** @scenario "The media listener refuses an unknown or expired nonce" */
    it("reports it expired and removes it so a replay reads unknown", () => {
      let now = 0;
      const registry = new VoiceNonceRegistry({ ttlMs: 100, now: () => now });
      registry.register({ nonce: "abc", child: fakeChild });

      now = 100; // exactly at the boundary counts as expired
      expect(registry.consume("abc")).toEqual({ ok: false, reason: "expired" });
      expect(registry.consume("abc")).toEqual({ ok: false, reason: "unknown" });
    });
  });

  describe("when a nonce is discarded", () => {
    it("is gone without being consumed", () => {
      const registry = new VoiceNonceRegistry();
      registry.register({ nonce: "abc", child: fakeChild });
      expect(registry.size).toBe(1);

      registry.discard("abc");
      expect(registry.size).toBe(0);
      expect(registry.consume("abc")).toEqual({ ok: false, reason: "unknown" });
    });
  });
});
