import { ChildProcess } from "node:child_process";

import { describe, expect, it } from "vitest";

import { MemoryVoiceNonceRepository } from "../../../repositories/memory/memory.voice-nonce.repository.ts";
import { VoiceNonceRegistryService } from "../../../services/voice-nonce-registry.service.ts";
import { MemoryVoiceNonceHandoffChannel } from "../memory.voice-nonce-handoff.channel.ts";

describe("MemoryVoiceNonceHandoffChannel", () => {
  describe("when the child registers its nonce", () => {
    it("lands in the parent's registry against that child", async () => {
      const registry = VoiceNonceRegistryService.create({
        nonces: MemoryVoiceNonceRepository.create(),
      });
      const child = new ChildProcess();
      const channel = MemoryVoiceNonceHandoffChannel.create({ registry, child });

      await channel.registerNonce({ nonce: "n1" });

      await expect(registry.consume("n1")).resolves.toEqual({ ok: true, child });
    });
  });
});
