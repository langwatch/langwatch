/** @vitest-environment node
 * @integration
 * The voice media nonce store against real Redis (specs/features/agents/voice-phone.feature).
 */

import { randomUUID } from "node:crypto";

import { type RedisConnection, RedisConnectionService } from "@langwatch/redis-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { VOICE_NONCE_DEFAULT_TTL_MS } from "../../../services/voice-nonce-registry.service.ts";
import { RedisVoiceNonceRepository } from "../redis.voice-nonce.repository.ts";

const written: string[] = [];

function freshNonce(): string {
  const nonce = randomUUID();
  written.push(nonce);
  return nonce;
}

let connection: RedisConnection | null = null;
let nonces: RedisVoiceNonceRepository;

describe.skipIf(!process.env.REDIS_URL)("RedisVoiceNonceRepository", () => {
  beforeAll(() => {
    connection = new RedisConnectionService().connect({
      url: process.env.REDIS_URL,
      clusterEndpoints: process.env.REDIS_CLUSTER_ENDPOINTS,
      dbIndex: process.env.REDIS_DB_INDEX,
    });
    if (!connection) {
      throw new Error("These tests need a real Redis; run them through the integration suite");
    }
    nonces = RedisVoiceNonceRepository.create(connection);
  });

  afterAll(async () => {
    for (const nonce of written) await nonces.discard(nonce);
    connection?.disconnect();
  });

  describe("given a nonce stored for an owner", () => {
    /** @scenario "Redis hands a nonce to exactly one of two racing upgrades" */
    it("answers the owner to exactly one of two racing takes", async () => {
      const nonce = freshNonce();
      await nonces.store({ nonce, registration: "reg-1", ttlSeconds: 60 });

      const takes = await Promise.all([nonces.take(nonce), nonces.take(nonce)]);

      expect(takes.filter((take) => take.taken)).toEqual([{ taken: true, registration: "reg-1" }]);
    });

    /** @scenario "Redis keeps a nonce for 60 seconds at most" */
    it("keeps it for the registry's lifetime and no longer", async () => {
      const nonce = freshNonce();
      await nonces.store({
        nonce,
        registration: "reg-1",
        ttlSeconds: Math.ceil(VOICE_NONCE_DEFAULT_TTL_MS / 1000),
      });

      const ttl = await connection?.ttl(`scenario_voice_nonce:v1:${nonce}`);

      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });
  });
});
