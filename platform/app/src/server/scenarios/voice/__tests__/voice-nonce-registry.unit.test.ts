/**
 * @see specs/features/agents/voice-phone.feature
 */

import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  SDK_STREAM_CONNECT_TIMEOUT_MS,
  VOICE_NONCE_DEFAULT_TTL_MS,
  VoiceNonceRegistry,
} from "../voice-nonce-registry";

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
      expect(registry.consume("abc")).toEqual({
        ok: false,
        reason: "expired",
        child: fakeChild,
      });
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

  describe("the default TTL against the SDK's own connect-wait window", () => {
    /**
     * This is the bug that shipped: a nonce registered before `placeCall`
     * must survive at least as long as the SDK is willing to wait for the
     * media socket to connect — otherwise a real, on-time dial-back (Twilio
     * rang the callee for tens of seconds first) finds an already-expired
     * nonce and is refused 403, which then reads as a misleading
     * "stream never connected" instead of the true cause.
     * @scenario "A dial-back arriving after ring delay is still accepted"
     */
    it("stays valid through a Twilio ring delay inside the SDK's connect-wait window", () => {
      let now = 0;
      const registry = new VoiceNonceRegistry({ now: () => now });
      registry.register({ nonce: "abc", child: fakeChild });

      // Twilio rings the callee for 55s (the real production TwiML timeout),
      // the callee answers, and the media stream socket arrives shortly
      // after — comfortably inside the SDK's own connect-wait budget.
      now = 55_000 + 5_000;
      expect(registry.consume("abc")).toEqual({ ok: true, child: fakeChild });
    });

    /** @scenario "A dial-back arriving after ring delay is still accepted" */
    it("stays valid all the way to the SDK's own connect-wait deadline", () => {
      let now = 0;
      const registry = new VoiceNonceRegistry({ now: () => now });
      registry.register({ nonce: "abc", child: fakeChild });

      // The latest moment a dial-back can legitimately still be waited on by
      // placeCall/waitForCall — one tick before the SDK's own timeout fires.
      now = SDK_STREAM_CONNECT_TIMEOUT_MS - 1;
      expect(registry.consume("abc")).toEqual({ ok: true, child: fakeChild });
    });

    /**
     * The TTL change must not quietly remove expiry protection: a nonce that
     * outlives even the SDK's own connect-wait window (the caller gave up
     * long ago) is still refused.
     * @scenario "A nonce that outlives the SDK's own wait window is still refused"
     */
    it("still expires a nonce nobody could legitimately still be waiting on", () => {
      let now = 0;
      const registry = new VoiceNonceRegistry({ now: () => now });
      registry.register({ nonce: "abc", child: fakeChild });

      now = VOICE_NONCE_DEFAULT_TTL_MS + 1;
      expect(registry.consume("abc")).toEqual({
        ok: false,
        reason: "expired",
        child: fakeChild,
      });
    });

    it("keeps the default TTL comfortably above the SDK's connect-wait timeout", () => {
      expect(VOICE_NONCE_DEFAULT_TTL_MS).toBeGreaterThan(
        SDK_STREAM_CONNECT_TIMEOUT_MS,
      );
    });
  });
});
