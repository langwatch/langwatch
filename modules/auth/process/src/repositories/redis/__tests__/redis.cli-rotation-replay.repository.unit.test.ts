/**
 * A rotation's shared pair rests sealed with the stores' cipher, under a digest of the spent
 * refresh token: no token appears in a key name, and none rests in the clear.
 * @see modules/auth/specs/cli-project-session.feature
 */
import type { SharedCredentialCipher } from "@langwatch/secrets/shared-credential";
import { memoryRedisDouble, memoryRedisStore } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { rotationReplayAddress } from "../../../features/cli-device/rules/cli-device-session.rules.ts";
import { RedisCliRotationReplayRepository } from "../redis.cli-rotation-replay.repository.ts";

/** A reversible stand-in for the stores' `encryption` client. */
const encryption: SharedCredentialCipher = {
  encrypt: (plaintext) => `sealed:${Buffer.from(plaintext).toString("base64")}`,
  decrypt: (ciphertext) => Buffer.from(ciphertext.slice("sealed:".length), "base64").toString(),
};

describe("RedisCliRotationReplayRepository", () => {
  describe("when a rotation's pair is held", () => {
    it("rests sealed under a digest of the spent token for the replay window", async () => {
      const store = memoryRedisStore();
      const redis = memoryRedisDouble({ store });
      const rotations = RedisCliRotationReplayRepository.create({ redis, encryption });
      const spent = "lw_rt_spent_token";
      const pair = JSON.stringify({ accessToken: "lw_at_new", refreshToken: "lw_rt_new" });
      const address = rotationReplayAddress(spent);

      await rotations.hold({ address, value: pair, ttlMs: 60_000 });

      const keys = [...store.strings.keys()];
      expect(keys).toEqual([`lwcli:refresh-replay:${address.tenantId}`]);
      expect(keys.join()).not.toContain(spent);
      const rested = await redis.get(keys[0] ?? "");
      expect(rested).toBe(JSON.stringify(encryption.encrypt(pair)));
      expect(rested).not.toContain("lw_rt_new");
      expect(await redis.ttl(keys[0] ?? "")).toBe(60);
      await expect(rotations.find(address)).resolves.toEqual([pair]);
    });
  });
});
