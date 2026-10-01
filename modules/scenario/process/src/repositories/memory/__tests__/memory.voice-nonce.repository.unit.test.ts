/**
 * @see specs/features/agents/voice-phone.feature
 */

import { describe, expect, it } from "vitest";

import { MemoryVoiceNonceRepository } from "../memory.voice-nonce.repository.ts";

describe("MemoryVoiceNonceRepository", () => {
  describe("given a nonce stored for an owner", () => {
    /** @scenario "A stored nonce is taken once, then reads as absent" */
    it("answers the owner on the first take and nothing on the second", async () => {
      const nonces = MemoryVoiceNonceRepository.create({ now: () => 0 });
      await nonces.store({ nonce: "n1", registration: "reg-1", ttlSeconds: 60 });

      await expect(nonces.take("n1")).resolves.toEqual({ taken: true, registration: "reg-1" });
      await expect(nonces.take("n1")).resolves.toEqual({ taken: false });
    });

    /** @scenario "A stored nonce not taken within its lifetime is gone" */
    it("answers nothing once its lifetime has passed", async () => {
      let now = 0;
      const nonces = MemoryVoiceNonceRepository.create({ now: () => now });
      await nonces.store({ nonce: "n1", registration: "reg-1", ttlSeconds: 60 });

      now = 60_000;

      await expect(nonces.take("n1")).resolves.toEqual({ taken: false });
    });
  });
});
