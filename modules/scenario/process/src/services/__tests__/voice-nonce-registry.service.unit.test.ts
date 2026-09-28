/**
 * @see specs/features/agents/voice-phone.feature
 */

import { ChildProcess } from "node:child_process";

import { describe, expect, it } from "vitest";

import { MemoryVoiceNonceRepository } from "../../repositories/memory/memory.voice-nonce.repository.ts";
import {
  VOICE_NONCE_DEFAULT_TTL_MS,
  VoiceNonceRegistryService,
} from "../voice-nonce-registry.service.ts";

/** A stand-in child; the registry only stores and returns the reference. */
const fakeChild = new ChildProcess();

/** A registry and its store, both on one hand-moved clock. */
function registryAt(clock: { now: number }, ttlMs?: number) {
  const now = () => clock.now;
  const nonces = MemoryVoiceNonceRepository.create({ now });
  return { nonces, registry: VoiceNonceRegistryService.create({ nonces, ttlMs, now }) };
}

describe("VoiceNonceRegistryService", () => {
  describe("given a registered nonce", () => {
    it("returns the owning child and its token once, then never again", async () => {
      const { registry } = registryAt({ now: 1000 });
      await registry.register({ nonce: "abc", child: fakeChild, authToken: "tok" });

      await expect(registry.consume("abc")).resolves.toEqual({
        ok: true,
        child: fakeChild,
        authToken: "tok",
      });
      await expect(registry.consume("abc")).resolves.toEqual({ ok: false, reason: "unknown" });
    });

    /** @scenario "A dial-back arriving after ring delay is still accepted" */
    it("still hands it over just inside the lifetime", async () => {
      const clock = { now: 0 };
      const { registry } = registryAt(clock);
      await registry.register({ nonce: "abc", child: fakeChild, authToken: "tok" });

      clock.now = VOICE_NONCE_DEFAULT_TTL_MS - 1;

      await expect(registry.consume("abc")).resolves.toMatchObject({ ok: true });
    });
  });

  describe("when the nonce was never registered", () => {
    /** @scenario "The media listener refuses an unknown or expired nonce" */
    it("reports it unknown", async () => {
      const { registry } = registryAt({ now: 0 });

      await expect(registry.consume("missing")).resolves.toEqual({ ok: false, reason: "unknown" });
    });
  });

  describe("when the nonce has expired", () => {
    /** @scenario "The media listener refuses an unknown or expired nonce" */
    it("reports it expired, naming the child, and a replay reads unknown", async () => {
      const clock = { now: 0 };
      const { registry } = registryAt(clock, 100);
      await registry.register({ nonce: "abc", child: fakeChild, authToken: "tok" });

      clock.now = 100; // exactly at the boundary counts as expired

      await expect(registry.consume("abc")).resolves.toEqual({
        ok: false,
        reason: "expired",
        child: fakeChild,
      });
      await expect(registry.consume("abc")).resolves.toEqual({ ok: false, reason: "unknown" });
    });
  });

  describe("when the dial-back outlives the default lifetime", () => {
    /** @scenario "A nonce that outlives the SDK's own wait window is still refused" */
    it("refuses it as expired", async () => {
      const clock = { now: 0 };
      const { registry } = registryAt(clock);
      await registry.register({ nonce: "abc", child: fakeChild, authToken: "tok" });

      clock.now = VOICE_NONCE_DEFAULT_TTL_MS;

      await expect(registry.consume("abc")).resolves.toMatchObject({
        ok: false,
        reason: "expired",
      });
    });
  });

  describe("given two workers sharing one nonce store", () => {
    /** @scenario "A nonce registered on another worker is refused here" */
    it("refuses the nonce on the worker that does not hold its child, and spends it", async () => {
      const clock = { now: 0 };
      const now = () => clock.now;
      const nonces = MemoryVoiceNonceRepository.create({ now });
      const first = VoiceNonceRegistryService.create({ nonces, now });
      const second = VoiceNonceRegistryService.create({ nonces, now });
      await first.register({ nonce: "abc", child: fakeChild, authToken: "tok" });

      await expect(second.consume("abc")).resolves.toEqual({ ok: false, reason: "unknown" });
      await expect(first.consume("abc")).resolves.toEqual({ ok: false, reason: "unknown" });
    });
  });

  describe("when a nonce is discarded", () => {
    it("is gone from this worker and the store without being consumed", async () => {
      const { registry, nonces } = registryAt({ now: 0 });
      await registry.register({ nonce: "abc", child: fakeChild, authToken: "tok" });
      expect(registry.size).toBe(1);

      await registry.discard("abc");

      expect(registry.size).toBe(0);
      await expect(nonces.take("abc")).resolves.toEqual({ taken: false });
    });
  });
});
